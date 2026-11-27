import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import type { EventEmitter } from 'node:events';
import type { EnvState } from './monitor.ts';
import type { History } from './history.ts';

/** Was die API vom Monitor braucht (für Tests ersetzbar). */
export interface MonitorLike extends EventEmitter {
  state(): EnvState[];
  unlock(envId: string): Promise<boolean>;
  /** Eine Umgebung oder alle. ran = Durchgang lief, nextInMs = Wartezeit bis zum nächsten Start; null = unbekannte Umgebung. */
  refreshAll(envId?: string): Promise<{ ran: boolean; nextInMs: number } | null>;
  setMaintenance(envId: string, on: boolean, reason?: string): boolean;
}

export interface AppOptions {
  monitor: MonitorLike;
  history: Pick<History, 'series'>;
  publicDir: string;
  intervals: { fastSeconds: number; slowSeconds: number };
  groups?: { id: string; label: string }[];
  now?: () => number;
  /** Beendet den Dienst. Ohne Angabe ist /api/shutdown abgeschaltet. */
  onShutdown?: () => void;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
};

const json = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
};

export function createApp(o: AppOptions): Server {
  const now = o.now ?? Date.now;
  const started = now();
  const streams = new Set<ServerResponse>();

  const snapshot = () => ({ serverTime: now(), intervals: o.intervals, groups: o.groups ?? [], envs: o.monitor.state() });

  // Updates bündeln: mehrere Ergebnisse in kurzer Folge = ein Ereignis.
  let pending: NodeJS.Timeout | null = null;
  const onChange = (): void => {
    if (pending) return;
    pending = setTimeout(() => {
      pending = null;
      const data = `event: state\ndata: ${JSON.stringify(snapshot())}\n\n`;
      for (const s of streams) s.write(data);
    }, 200);
    pending.unref();
  };
  o.monitor.on('update', onChange);
  o.monitor.on('maintenance', onChange);
  const keepalive = setInterval(() => streams.forEach((s) => s.write(': keepalive\n\n')), 25_000);
  keepalive.unref();

  const server = createServer((req, res) => {
    void handle(req, res).catch((e) => {
      if (!res.headersSent) json(res, 500, { error: (e as Error).message });
      else res.end();
    });
  });
  server.on('close', () => {
    clearInterval(keepalive);
    if (pending) clearTimeout(pending);
    streams.forEach((s) => s.end());
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;

    // "app" erlaubt dem Start, eine alte Dashboard-Session von fremden Diensten zu unterscheiden.
    if (path === '/healthz') return json(res, 200, { ok: true, app: 'aem-health-dashboard' });

    if (path === '/api/shutdown') {
      // Gleicher Schutz wie bei /api/unlock: fremde Webseiten können das nicht auslösen.
      if (!o.onShutdown || req.method !== 'POST' || req.headers['x-requested-with'] !== 'dashboard') return json(res, 403, { error: 'Nicht erlaubt.' });
      json(res, 200, { ok: true });
      res.on('finish', () => o.onShutdown!());
      return;
    }
    if (path === '/api/state') return json(res, 200, snapshot());

    if (path === '/api/stats') {
      return json(res, 200, {
        uptimeSeconds: Math.round((now() - started) / 1000),
        envs: o.monitor.state().map((s) => ({ id: s.id, requestsPerMinute: s.requestsPerMinute, locked: s.locked })),
      });
    }

    if (path === '/api/stream') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      res.write(`event: state\ndata: ${JSON.stringify(snapshot())}\n\n`);
      streams.add(res);
      req.on('close', () => streams.delete(res));
      return;
    }

    if (path === '/api/history') {
      const env = url.searchParams.get('env') ?? '';
      const id = url.searchParams.get('id') ?? '';
      const hours = Math.min(Math.max(Number(url.searchParams.get('hours') ?? 24) || 24, 1), 24 * 7);
      const known = o.monitor.state().find((s) => s.id === env)?.checks.some((c) => c.id === id);
      if (!known) return json(res, 404, { error: 'Unbekannte Umgebung oder Check.' });
      return json(res, 200, { env, id, hours, points: o.history.series(env, id, now() - hours * 3_600_000) });
    }

    if (path === '/api/unlock') {
      // Eigener Header erzwingt einen CORS-Preflight: fremde Webseiten können das nicht auslösen.
      if (req.method !== 'POST' || req.headers['x-requested-with'] !== 'dashboard') return json(res, 403, { error: 'Nicht erlaubt.' });
      const ok = await o.monitor.unlock(url.searchParams.get('env') ?? '');
      return json(res, ok ? 200 : 404, { ok });
    }

    if (path === '/api/refresh') {
      if (req.method !== 'POST' || req.headers['x-requested-with'] !== 'dashboard') return json(res, 403, { error: 'Nicht erlaubt.' });
      const r = await o.monitor.refreshAll(url.searchParams.get('env') || undefined);
      if (!r) return json(res, 404, { ok: false });
      return json(res, r.ran ? 200 : 429, { ok: r.ran, nextInMs: r.nextInMs });
    }

    if (path === '/api/maintenance') {
      if (req.method !== 'POST' || req.headers['x-requested-with'] !== 'dashboard') return json(res, 403, { error: 'Nicht erlaubt.' });
      const ok = o.monitor.setMaintenance(url.searchParams.get('env') ?? '', url.searchParams.get('on') === '1', url.searchParams.get('reason') ?? '');
      return json(res, ok ? 200 : 404, { ok });
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'Nur GET.' });
    return serveStatic(path, res);
  }

  function serveStatic(path: string, res: ServerResponse): void {
    const rel = normalize(decodeURIComponent(path === '/' ? '/index.html' : path));
    const file = join(o.publicDir, rel);
    if (!file.startsWith(o.publicDir + sep) || !existsSync(file) || !statSync(file).isFile()) return json(res, 404, { error: 'Nicht gefunden.' });
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
    createReadStream(file).pipe(res);
  }

  return server;
}
