import { EventEmitter } from 'node:events';
import { AemClient } from './aem-client.ts';
import { fetchVersions, runFast, runSlow, type Ctx } from './checks.ts';
import type { Credentials, EnvConfig } from './config.ts';
import { evaluate, overall } from './evaluate.ts';
import { createLoop, type Loop } from './scheduler.ts';
import type { CheckDef, ChecksConfig, CheckResult, Evaluated, Overall, Versions } from './types.ts';

export interface EnvState {
  id: string;
  label: string;
  checks: (Evaluated & { def: CheckDef })[];
  overall: Overall;
  /** Wartungsmodus: Grund (leer = ohne Angabe) oder null. Es werden keine Anfragen gesendet. */
  maintenance: string | null;
  /** Versionen der Author-Instanz; leer, solange nicht gelesen (auch in Wartung). */
  versions: Versions;
  /** Grund der Sperre (Anmeldung abgelehnt) oder null. */
  locked: string | null;
  requestsPerMinute: { author: number; publish: number };
  /** Zeitpunkte (ms) des letzten schnellen/langsamen Laufs. */
  updatedAt: { fast: number | null; slow: number | null };
}

interface EnvRuntime {
  cfg: EnvConfig;
  ctx: Ctx;
  /** Wartungsmodus: Grund (leer = ohne Angabe) oder null. */
  maintenance: string | null;
  /** Versionen der Author-Instanz; ein Wert bleibt bei einem Fehlversuch bestehen. */
  versions: Versions;
  results: Map<string, Evaluated>;
  /** Aufeinanderfolgende Fehlmessungen je Check (für die Entprellung). */
  misses: Map<string, number>;
  /** Zeitpunkte der Läufe mit Wiederholung je Check. */
  retryTimes: Map<string, number[]>;
  updatedAt: { fast: number | null; slow: number | null };
  loops: Loop[];
}

const RETRY_WINDOW_MS = 3_600_000;
export const REFRESH_COOLDOWN_MS = 15_000;

/** Hält den Zustand aller Umgebungen und betreibt die zwei Takte. Ereignis `update` bei jeder Änderung. */
export class Monitor extends EventEmitter {
  private readonly envs = new Map<string, EnvRuntime>();
  private readonly defs: CheckDef[];
  private started = false;

  constructor(
    environments: EnvConfig[],
    private readonly config: ChecksConfig,
    credentials: Credentials,
    makeClients?: (e: EnvConfig) => { author: AemClient; publish: AemClient },
  ) {
    super();
    this.defs = config.checks;
    for (const cfg of environments) {
      const clients = makeClients?.(cfg) ?? {
        author: new AemClient({ baseUrl: cfg.baseUrl, credentials }),
        publish: new AemClient({ baseUrl: cfg.publishUrl }),
      };
      const rt: EnvRuntime = { cfg, ctx: { ...clients }, maintenance: cfg.maintenance ? (typeof cfg.maintenance === 'string' ? cfg.maintenance : '') : null, versions: { aem: null, java: null, oak: null }, results: new Map(), misses: new Map(), retryTimes: new Map(), updatedAt: { fast: null, slow: null }, loops: [] };
      rt.ctx.onInfo = (patch) => this.mergeVersions(rt, patch);
      this.envs.set(cfg.id, rt);
    }
  }

  /** Startet die Takte. Umgebungen starten versetzt, damit nicht alles gleichzeitig anfragt. Umgebungen in Wartung ruhen. */
  start(): void {
    this.started = true;
    let i = 0;
    for (const env of this.envs.values()) this.startEnv(env, i++ * 2000);
  }

  private startEnv(env: EnvRuntime, offset: number): void {
    if (env.maintenance !== null) return;
    const { fastSeconds, slowSeconds } = this.config.intervals;
    env.loops = [
      createLoop({ run: () => this.runTempo(env, 'fast'), intervalMs: fastSeconds * 1000, initialDelayMs: offset }),
      createLoop({ run: () => this.runTempo(env, 'slow'), intervalMs: slowSeconds * 1000, initialDelayMs: offset + 1000 }),
    ];
    env.loops.forEach((l) => l.start());
  }

  /** Schaltet den Wartungsmodus. An: Takte stoppen, nichts wird angefragt. Aus: frische Messung von vorn. */
  setMaintenance(envId: string, on: boolean, reason = ''): boolean {
    const env = this.envs.get(envId);
    if (!env) return false;
    env.loops.forEach((l) => l.stop());
    env.loops = [];
    env.results.clear();
    env.versions = { aem: null, java: null, oak: null };
    env.misses.clear();
    env.retryTimes.clear();
    env.updatedAt = { fast: null, slow: null };
    env.maintenance = on ? reason.trim().slice(0, 80) : null;
    if (this.started) this.startEnv(env, 0);
    this.emit('maintenance', envId, env.maintenance);
    return true;
  }

  stop(): void {
    for (const env of this.envs.values()) env.loops.forEach((l) => l.stop());
  }

  /** Einmaliger Lauf beider Takte (für das CLI). */
  async runOnce(): Promise<void> {
    for (const env of this.envs.values()) {
      if (env.maintenance !== null) continue;
      await this.runTempo(env, 'fast');
      await this.runTempo(env, 'slow');
    }
  }

  private readonly inflight = new Map<string, Promise<void>>();
  private readonly refreshing = new Map<string, Promise<void>>();
  private readonly lastRefreshAt = new Map<string, number>();

  /**
   * Löst beide Takte sofort aus: für eine Umgebung (`envId`) oder alle. Wartung und Sperre bleiben unberührt.
   * Je Umgebung gilt: läuft schon ein Durchgang, wird er mitgenutzt. Sonst gilt eine Pause seit dem letzten Start (für alle Browser).
   * Rückgabe: ran = mindestens eine Umgebung lief, nextInMs = Wartezeit bis zum nächsten erlaubten Start; null = unbekannte Umgebung.
   */
  async refreshAll(envId?: string): Promise<{ ran: boolean; nextInMs: number } | null> {
    const targets = envId ? [this.envs.get(envId)].filter((e) => e !== undefined) : [...this.envs.values()];
    if (targets.length === 0) return null;
    const waits: Promise<void>[] = [];
    let ran = false;
    for (const e of targets) {
      if (e.maintenance !== null) continue;
      const id = e.cfg.id;
      let p = this.refreshing.get(id);
      if (!p) {
        if ((this.lastRefreshAt.get(id) ?? -Infinity) + REFRESH_COOLDOWN_MS > Date.now()) continue;
        this.lastRefreshAt.set(id, Date.now());
        p = (async () => {
          await this.runTempo(e, 'fast');
          await this.runTempo(e, 'slow');
        })().finally(() => this.refreshing.delete(id));
        this.refreshing.set(id, p);
      }
      ran = true;
      waits.push(p);
    }
    await Promise.all(waits);
    const nextInMs = Math.max(0, ...targets.map((e) => (this.lastRefreshAt.get(e.cfg.id) ?? -Infinity) + REFRESH_COOLDOWN_MS - Date.now()));
    // Nur Wartung: nichts zu tun, aber auch nichts zu sperren.
    return { ran: ran || targets.every((e) => e.maintenance !== null), nextInMs };
  }

  /** Hebt die Sperre auf (manueller Klick/Neustart) und prüft sofort neu. */
  async unlock(envId: string): Promise<boolean> {
    const env = this.envs.get(envId);
    if (!env) return false;
    if (env.maintenance !== null) return true;
    env.ctx.author.unlock();
    await this.runTempo(env, 'fast');
    return true;
  }

  state(): EnvState[] {
    return [...this.envs.values()].map((e) => this.stateOf(e));
  }

  /** Läuft derselbe Takt der Umgebung schon (Schleife, Button, Entsperren), wird auf diesen Lauf gewartet statt neu angefragt. */
  private runTempo(env: EnvRuntime, tempo: 'fast' | 'slow'): Promise<void> {
    const key = `${env.cfg.id}:${tempo}`;
    let p = this.inflight.get(key);
    if (!p) {
      p = this.doRunTempo(env, tempo).finally(() => this.inflight.delete(key));
      this.inflight.set(key, p);
    }
    return p;
  }

  private async doRunTempo(env: EnvRuntime, tempo: 'fast' | 'slow'): Promise<void> {
    const [results, versions] = await Promise.all([tempo === 'fast' ? runFast(env.ctx) : runSlow(env.ctx), tempo === 'slow' ? fetchVersions(env.ctx) : null]);
    if (versions) this.mergeVersions(env, versions);
    this.apply(env, results, tempo);
  }

  /** Übernimmt gelesene Versionen. Ein fehlender Wert überschreibt den letzten bekannten nicht. */
  private mergeVersions(env: EnvRuntime, patch: Partial<Versions>): void {
    if (env.maintenance !== null) return;
    for (const k of ['aem', 'java', 'oak'] as const) if (patch[k]) env.versions[k] = patch[k];
  }

  private apply(env: EnvRuntime, results: CheckResult[], tempo: 'fast' | 'slow'): void {
    if (env.maintenance !== null) return; // Lauf war beim Einschalten noch unterwegs
    const evaluated: Evaluated[] = [];
    const now = Date.now();
    for (const r of results) {
      const def = this.defs.find((d) => d.id === r.id);
      if (!def) continue;
      const e = evaluate(def, r);
      evaluated.push(e); // Verlauf bekommt immer die echte Messung

      const times = (env.retryTimes.get(r.id) ?? []).filter((t) => t > now - RETRY_WINDOW_MS);
      if (r.retried) times.push(now);
      env.retryTimes.set(r.id, times);

      // Entprellung: ein einzelner Ausfall zeigt noch den vorherigen Wert. Beim zweiten in Folge gilt "unbekannt".
      const prev = env.results.get(r.id);
      const miss = e.status === 'unknown' ? (env.misses.get(r.id) ?? 0) + 1 : 0;
      env.misses.set(r.id, miss);
      const hold = miss === 1 && prev && prev.status !== 'unknown' && !env.ctx.author.locked;
      const shown: Evaluated = hold
        ? { ...prev, held: true, retried: r.retried, detail: r.detail, retries1h: times.length || undefined }
        : { ...e, held: undefined, retries1h: times.length || undefined };
      env.results.set(r.id, shown);
    }
    env.updatedAt[tempo] = Date.now();
    this.emit('update', env.cfg.id, tempo, evaluated);
  }

  private stateOf(env: EnvRuntime): EnvState {
    const m = env.maintenance;
    const none = (def: CheckDef) => ({ id: def.id, value: null, at: 0, status: 'unknown' as const, detail: m !== null ? 'In Wartung, nicht geprüft.' : undefined });
    const checks = this.defs.map((def) => ({ def, ...(env.results.get(def.id) ?? none(def)) }));
    return {
      id: env.cfg.id,
      label: env.cfg.label,
      checks,
      maintenance: m,
      versions: { ...env.versions },
      overall: overall(this.defs, env.results),
      locked: env.ctx.author.locked,
      requestsPerMinute: { author: env.ctx.author.requestsPerMinute(), publish: env.ctx.publish.requestsPerMinute() },
      updatedAt: { ...env.updatedAt },
    };
  }
}
