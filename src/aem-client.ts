import { AsyncLocalStorage } from 'node:async_hooks';
import type { Credentials } from './config.ts';

/** Vermerkt je Check, ob eine Anfrage wiederholt werden musste (siehe `guard` in checks.ts). */
export const retryScope = new AsyncLocalStorage<{ retried: boolean }>();

/**
 * Lastschonender, rein lesender AEM-Client.
 * - Anmeldung einmal per Login-Formular (Cookie), danach nur GET mit Cookie.
 * - Timeout, max. N parallele Requests, Zähler Requests/min.
 * - Circuit-Breaker: schlägt die Anmeldung fehl (401/403), sperrt der Client alle
 *   authentifizierten Requests, bis `unlock()` aufgerufen wird. Das falsche Passwort
 *   wird nie wiederholt gesendet.
 */

export class LockedError extends Error {
  constructor(public readonly reason: string) {
    super(`Zugang gesperrt: ${reason}`);
    this.name = 'LockedError';
  }
}

export interface AemResponse {
  status: number;
  ms: number;
  bytes: number;
  body: string;
  /** Netzwerkfehler/Timeout: status 0 und Text hier. */
  error?: string;
}

export interface ClientOptions {
  baseUrl: string;
  credentials?: Credentials;
  timeoutMs?: number;
  maxParallel?: number;
  /** Test-Hook: ersetzt fetch. */
  fetchImpl?: typeof fetch;
}

const LOGIN_PATH = '/libs/granite/core/content/login.html/j_security_check';
const RELOGIN_MIN_INTERVAL_MS = 60_000;

export class AemClient {
  readonly baseUrl: string;
  private readonly creds?: Credentials;
  private readonly timeoutMs: number;
  private readonly maxParallel: number;
  private readonly fetchImpl: typeof fetch;
  private cookie = '';
  private lastLoginAt = 0;
  private lockReason: string | null = null;
  private active = 0;
  private waiters: (() => void)[] = [];
  private readonly stamps: number[] = [];

  constructor(o: ClientOptions) {
    this.baseUrl = o.baseUrl.replace(/\/+$/, '');
    this.creds = o.credentials;
    this.timeoutMs = o.timeoutMs ?? 5000;
    this.maxParallel = o.maxParallel ?? 2;
    this.fetchImpl = o.fetchImpl ?? fetch;
  }

  get locked(): string | null {
    return this.lockReason;
  }

  unlock(): void {
    this.lockReason = null;
    this.cookie = '';
  }

  /** Requests in der letzten Minute. */
  requestsPerMinute(now = Date.now()): number {
    while (this.stamps.length && (this.stamps[0] as number) < now - 60_000) this.stamps.shift();
    return this.stamps.length;
  }

  /** Anonymer GET (z.B. Publish). */
  getAnonymous(path: string): Promise<AemResponse> {
    return this.request('GET', path, false);
  }

  /** Authentifizierter GET. Wirft LockedError, solange gesperrt. */
  async get(path: string): Promise<AemResponse> {
    if (this.lockReason) throw new LockedError(this.lockReason);
    if (!this.cookie) await this.login();
    let res = await this.request('GET', path, true);
    if (res.status === 401 || res.status === 302) {
      // Sitzung abgelaufen: höchstens eine neue Anmeldung pro Minute.
      if (Date.now() - this.lastLoginAt < RELOGIN_MIN_INTERVAL_MS) return res;
      await this.login();
      res = await this.request('GET', path, true);
    }
    return res;
  }

  /** Anmeldung. Bei Ablehnung: sperren und LockedError. Netzwerkfehler sperren nicht. */
  async login(): Promise<void> {
    if (!this.creds) throw new LockedError('keine Zugangsdaten konfiguriert');
    if (this.lockReason) throw new LockedError(this.lockReason);
    const body = new URLSearchParams({
      j_username: this.creds.user,
      j_password: this.creds.password,
      j_validate: 'true',
      _charset_: 'utf-8',
    }).toString();
    this.lastLoginAt = Date.now();
    const res = await this.raw('POST', LOGIN_PATH, false, body);
    if (res.status === 0) throw new Error(`Anmeldung nicht möglich: ${res.error}`);
    if (res.status === 401 || res.status === 403) {
      this.lockReason = `Anmeldung abgelehnt (HTTP ${res.status})`;
      this.cookie = '';
      throw new LockedError(this.lockReason);
    }
    if (!this.cookie) throw new Error(`Anmeldung ohne Sitzung (HTTP ${res.status})`);
  }

  /** GET mit einer Wiederholung bei Netzwerkfehler oder Timeout (status 0). HTTP-Fehler werden nicht wiederholt. */
  private async request(method: string, path: string, auth: boolean): Promise<AemResponse> {
    const res = await this.raw(method, path, auth);
    if (res.status !== 0) return res;
    const scope = retryScope.getStore();
    if (scope) scope.retried = true;
    return this.raw(method, path, auth);
  }

  private async raw(method: string, path: string, auth: boolean, form?: string): Promise<AemResponse> {
    await this.acquire();
    const start = performance.now();
    this.stamps.push(Date.now());
    try {
      const headers: Record<string, string> = { Accept: 'application/json, text/html;q=0.8', 'User-Agent': 'aem-health-dashboard' };
      if (auth && this.cookie) headers.Cookie = this.cookie;
      if (form) headers['Content-Type'] = 'application/x-www-form-urlencoded';
      const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: form,
        redirect: 'manual',
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      const text = await res.text();
      if (form) this.storeCookie(res.headers.getSetCookie());
      return { status: res.status, ms: Math.round(performance.now() - start), bytes: Buffer.byteLength(text), body: text };
    } catch (e) {
      const err = e as Error;
      const msg = err.name === 'TimeoutError' ? `Timeout nach ${this.timeoutMs} ms` : (err.cause as Error | undefined)?.message ?? err.message;
      return { status: 0, ms: Math.round(performance.now() - start), bytes: 0, body: '', error: msg };
    } finally {
      this.release();
    }
  }

  private storeCookie(setCookies: string[]): void {
    const pairs = setCookies.map((c) => c.split(';')[0] as string).filter((c) => !/=$/.test(c));
    if (pairs.length) this.cookie = pairs.join('; ');
  }

  private acquire(): Promise<void> {
    if (this.active < this.maxParallel) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.waiters.push(() => { this.active++; resolve(); }));
  }

  private release(): void {
    this.active--;
    this.waiters.shift()?.();
  }
}
