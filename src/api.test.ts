import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { createApp, type MonitorLike } from './api.ts';
import { History } from './history.ts';
import type { EnvState } from './monitor.ts';

const def = { id: 'resp_author', label: 'Antwortzeit', element: 'gauge', tempo: 'fast', group: 'g', weight: 1, critical: false } as const;
const envState = (locked: string | null = null): EnvState => ({
  id: 'dev',
  label: 'DEV',
  checks: [{ def, id: 'resp_author', value: 100, at: 1, status: 'ok' }],
  overall: { status: 'ok', score: 100, counts: { ok: 1, warn: 0, crit: 0, unknown: 0 } },
  maintenance: null,
  versions: { aem: null, java: null, oak: null },
  locked,
  requestsPerMinute: { author: 5, publish: 1 },
  updatedAt: { fast: 1, slow: null },
});

class StubMonitor extends EventEmitter implements MonitorLike {
  unlocked: string[] = [];
  maint: [string, boolean, string | undefined][] = [];
  state = () => [envState()];
  setMaintenance(id: string, on: boolean, reason?: string) {
    this.maint.push([id, on, reason]);
    return id === 'dev';
  }
  async unlock(id: string) {
    this.unlocked.push(id);
    return id === 'dev';
  }
}

const monitor = new StubMonitor();
const dir = mkdtempSync(`${tmpdir()}/api-`);
const pub = `${dir}/public`;
const history = new History(`${dir}/h`, 7, () => 1_000_000);
let base = '';
let close: () => void = () => {};

before(async () => {
  const { mkdirSync } = await import('node:fs');
  mkdirSync(pub);
  writeFileSync(`${pub}/index.html`, '<h1>Dashboard</h1>');
  writeFileSync(`${dir}/geheim.txt`, 'geheim');
  history.append('dev', 'fast', [{ id: 'resp_author', value: 100, at: 0, status: 'ok' }]);
  const app = createApp({ monitor, history, publicDir: pub, intervals: { fastSeconds: 30, slowSeconds: 300 }, now: () => 1_000_000 });
  await new Promise<void>((r) => app.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(app.address() as AddressInfo).port}`;
  close = () => { app.closeAllConnections(); app.close(); };
});
after(() => close());

test('healthz, state, stats', async () => {
  assert.deepEqual(await (await fetch(`${base}/healthz`)).json(), { ok: true, app: 'aem-health-dashboard' });
  const s = (await (await fetch(`${base}/api/state`)).json()) as { envs: EnvState[]; intervals: { fastSeconds: number } };
  assert.equal(s.envs[0]?.id, 'dev');
  assert.equal(s.intervals.fastSeconds, 30);
  const st = (await (await fetch(`${base}/api/stats`)).json()) as { envs: { requestsPerMinute: { author: number } }[] };
  assert.equal(st.envs[0]?.requestsPerMinute.author, 5);
});

test('history: bekannte Reihe, unbekannte Umgebung/Check = 404', async () => {
  const ok = (await (await fetch(`${base}/api/history?env=dev&id=resp_author&hours=24`)).json()) as { points: unknown[] };
  assert.equal(ok.points.length, 1);
  assert.equal((await fetch(`${base}/api/history?env=x&id=resp_author`)).status, 404);
  assert.equal((await fetch(`${base}/api/history?env=dev&id=gibtsnicht`)).status, 404);
});

test('unlock: nur POST mit Schutz-Header', async () => {
  assert.equal((await fetch(`${base}/api/unlock?env=dev`, { method: 'POST' })).status, 403);
  assert.equal((await fetch(`${base}/api/unlock?env=dev`)).status, 403);
  const h = { 'X-Requested-With': 'dashboard' };
  assert.equal((await fetch(`${base}/api/unlock?env=dev`, { method: 'POST', headers: h })).status, 200);
  assert.equal((await fetch(`${base}/api/unlock?env=zzz`, { method: 'POST', headers: h })).status, 404);
  assert.deepEqual(monitor.unlocked, ['dev', 'zzz']);
});

test('static: Startseite ja, Pfad-Ausbruch nein', async () => {
  assert.match(await (await fetch(`${base}/`)).text(), /Dashboard/);
  assert.equal((await fetch(`${base}/..%2fgeheim.txt`)).status, 404);
  assert.equal((await fetch(`${base}/%2e%2e/geheim.txt`)).status, 404);
  assert.equal((await fetch(`${base}/gibts-nicht.js`)).status, 404);
  assert.equal((await fetch(`${base}/`, { method: 'POST' })).status, 405);
});

test('SSE: sofort ein Zustand, bei Update ein weiterer', async () => {
  const ctrl = new AbortController();
  const res = await fetch(`${base}/api/stream`, { signal: ctrl.signal });
  assert.equal(res.headers.get('content-type'), 'text/event-stream');
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let seen = '';
  const readUntil = async (n: number) => {
    while ((seen.match(/event: state/g) ?? []).length < n) {
      const { value, done } = await reader.read();
      if (done) break;
      seen += dec.decode(value);
    }
  };
  await readUntil(1);
  monitor.emit('update', 'dev', 'fast', []);
  await readUntil(2);
  ctrl.abort();
  assert.equal((seen.match(/event: state/g) ?? []).length, 2);
});

test('maintenance: nur POST mit Schutz-Header', async () => {
  assert.equal((await fetch(`${base}/api/maintenance?env=dev&on=1`, { method: 'POST' })).status, 403);
  const h = { 'X-Requested-With': 'dashboard' };
  assert.equal((await fetch(`${base}/api/maintenance?env=dev&on=1&reason=Upgrade`, { method: 'POST', headers: h })).status, 200);
  assert.equal((await fetch(`${base}/api/maintenance?env=zzz&on=0`, { method: 'POST', headers: h })).status, 404);
  assert.deepEqual(monitor.maint, [['dev', true, 'Upgrade'], ['zzz', false, '']]);
});
