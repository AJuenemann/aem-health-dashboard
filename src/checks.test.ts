import test from 'node:test';
import assert from 'node:assert/strict';
import { AemClient } from './aem-client.ts';
import { MISSING_PAGE, PUBLISH_PAGE, fetchVersions, runFast, runSlow, type Ctx } from './checks.ts';
import { tcpReach } from './reach.ts';
import { startFakeAem, type FakeAem, type Route } from './fake-aem.ts';
import type { CheckResult } from './types.ts';

const NOW = 1_000_000_000_000;
const q = (blocked: boolean, times: number[]): Route => ({
  auth: true,
  body: JSON.stringify({ metaData: { queueStatus: { isBlocked: blocked, isPaused: false } }, queue: times.map((time) => ({ time })) }),
});
const agents = JSON.stringify({
  'jcr:content': {},
  pub: { 'jcr:content': { enabled: 'true', transportUri: 'http://x/bin/receive' } },
  off: { 'jcr:content': { enabled: 'false', transportUri: 'http://x/bin/receive' } },
});
const AGENTS = '/etc/replication/agents.author.2.json';
const QUEUE = '/etc/replication/agents.author/pub/jcr:content.queue.json';
const heap = '<td>Attribute Value</td><td>HeapMemoryUsage</td><td>max</td><td>100</td><td>used</td><td>40</td>';
const val = (n: number): Route => ({ auth: true, body: `<td>Attribute Value</td><td>Value</td><td>${n}</td>` });

const authorRoutes = (blocked = false): Record<string, Route> => ({
  '/libs/granite/core/content/login.html': { body: 'login' },
  [AGENTS]: { auth: true, body: agents },
  [QUEUE]: q(blocked, blocked ? [NOW - 30 * 60000] : []),
  '/system/console/bundles.json': { auth: true, body: '{"s":[10,9,1,0,0],"data":[]}' },
  '/system/console/jmx/java.lang%3Atype%3DMemory': { auth: true, body: heap },
  '/system/console/jmx/com.adobe.granite%3Aname%3DDISK_USABLE_SPACE%2Ctype%3DMetrics': val(25),
  '/system/console/jmx/com.adobe.granite%3Aname%3DDISK_TOTAL_SPACE%2Ctype%3DMetrics': val(100),
  '/system/console/slingevent.json': { auth: true, body: '<td>Queued Jobs</td><td>3</td>' },
  '/content/samples/de.json': { auth: true, body: '{}' },
  '/content/dam/samples.json': { auth: true, body: '{}' },
});
const publishRoutes: Record<string, Route> = {
  [PUBLISH_PAGE]: { body: '<div class="fhg-header"></div>' },
  [MISSING_PAGE]: { status: 404, body: '<title>Fehlerseite 404</title>' },
  '/content/samples/de.html': { body: 'samples' },
};

async function setup(author: Record<string, Route>, publish: Record<string, Route>, timeoutMs = 2000) {
  const a = await startFakeAem(author);
  const p = await startFakeAem(publish);
  const ctx: Ctx = {
    author: new AemClient({ baseUrl: a.url, credentials: { user: 'u', password: 'p' }, timeoutMs }),
    publish: new AemClient({ baseUrl: p.url, timeoutMs }),
    now: () => NOW,
  };
  return { a, p, ctx, close: async () => { await a.close(); await p.close(); } };
}
const by = (rs: CheckResult[]): Record<string, number | null> => Object.fromEntries(rs.map((r) => [r.id, r.value]));

test('runFast: gesunder Zustand', async () => {
  const s = await setup(authorRoutes(), publishRoutes);
  const r = by(await runFast(s.ctx));
  await s.close();
  assert.deepEqual(
    [r.vpn, r.author_up, r.login, r.publish_up, r.publish_agent, r.repl_blocked, r.repl_queue, r.repl_oldest],
    [1, 1, 1, 1, 1, 0, 0, 0],
  );
  assert.ok((r.resp_author ?? -1) >= 0 && (r.resp_publish ?? -1) >= 0);
});

test('runFast: blockierter Publish-Agent wird erkannt', async () => {
  const s = await setup(authorRoutes(true), publishRoutes);
  const r = by(await runFast(s.ctx));
  await s.close();
  assert.deepEqual([r.publish_agent, r.repl_blocked, r.repl_queue, r.repl_oldest], [0, 1, 1, 30]);
});

test('runFast: Login abgelehnt (403) sperrt, danach keine weiteren Requests', async () => {
  const s = await setup(authorRoutes(), publishRoutes);
  s.a.loginOk = false;
  const first = by(await runFast(s.ctx));
  const loginPosts = () => s.a.log.filter((l) => l.startsWith('POST')).length;
  assert.equal(first.login, 0);
  assert.equal(first.repl_blocked, null);
  assert.ok(s.ctx.author.locked);
  const before = loginPosts();
  await runFast(s.ctx);
  await runSlow(s.ctx);
  await s.close();
  assert.equal(loginPosts(), before, 'nach der Sperre kein weiterer Login-Versuch');
});

test('runFast: Server-Fehler 500 = unbekannt, nicht grün und nicht gesperrt', async () => {
  const author = { ...authorRoutes(), [AGENTS]: { auth: true, status: 500, body: 'Fehler' } };
  const s = await setup(author, publishRoutes);
  const r = by(await runFast(s.ctx));
  await s.close();
  assert.equal(r.login, null);
  assert.equal(r.publish_agent, null);
  assert.equal(s.ctx.author.locked, null);
});

test('runFast: Timeout = unbekannt', async () => {
  const author = { ...authorRoutes(), [AGENTS]: { auth: true, body: agents, delayMs: 400 } };
  const s = await setup(author, publishRoutes, 100);
  const r = by(await runFast(s.ctx));
  await s.close();
  assert.equal(r.resp_author, null);
  assert.equal(r.repl_blocked, null);
});

test('runFast: Publish ohne Fraunhofer-Header = rot', async () => {
  const s = await setup(authorRoutes(), { ...publishRoutes, [PUBLISH_PAGE]: { body: 'Wartungsseite' } });
  const r = by(await runFast(s.ctx));
  await s.close();
  assert.equal(r.publish_up, 0);
});

test('runSlow: gesunder Zustand', async () => {
  const s = await setup(authorRoutes(), publishRoutes);
  const r = by(await runSlow(s.ctx));
  await s.close();
  assert.deepEqual(
    [r.error_page, r.samples_author, r.samples_publish, r.bundles_inactive, r.heap, r.disk, r.jobs_queued],
    [1, 1, 1, 0, 40, 75, 3],
  );
});

test('runSlow: Samples fehlen auf Publish = rot, Fehlerseite roh = rot', async () => {
  const publish = { ...publishRoutes, '/content/samples/de.html': { status: 404 }, [MISSING_PAGE]: { status: 404, body: 'Resource not found' } };
  const s = await setup(authorRoutes(), publish);
  const rs = await runSlow(s.ctx);
  await s.close();
  const r = by(rs);
  // Author grün, nur Publish rot: getrennt sichtbar.
  assert.deepEqual([r.samples_author, r.samples_publish, r.error_page], [1, 0, 0]);
  assert.match(rs.find((x) => x.id === 'samples_publish')?.detail ?? '', /HTTP 404/);
});

test('Lastschutz: Anfragen pro Minute werden gezählt', async () => {
  const s = await setup(authorRoutes(), publishRoutes);
  await runFast(s.ctx);
  await s.close();
  assert.ok(s.ctx.author.requestsPerMinute() >= 4);
});

export type { FakeAem };

test('Timeout: Anfrage wird einmal wiederholt, Check ist als wiederholt markiert', async () => {
  const s = await setup(authorRoutes(), { ...publishRoutes, [MISSING_PAGE]: { status: 404, body: '<title>Fehlerseite 404</title>', delayMs: 600 } }, 150);
  const r = (await runSlow(s.ctx)).find((x) => x.id === 'error_page')!;
  const tries = s.p.log.filter((l) => l === `GET ${MISSING_PAGE}`).length;
  await s.close();
  assert.equal(tries, 2);
  assert.deepEqual([r.value, r.retried], [null, true]);
});

test('Timeout: Erfolg im zweiten Versuch liefert den Wert, markiert als wiederholt', async () => {
  const s = await setup(authorRoutes(), { ...publishRoutes, [MISSING_PAGE]: { status: 404, body: '<title>Fehlerseite 404</title>', delayMs: 600 } }, 250);
  setTimeout(() => (s.p.routes.get(MISSING_PAGE)!.delayMs = 0), 100);
  const rs = await runSlow(s.ctx);
  await s.close();
  assert.deepEqual([rs.find((x) => x.id === 'error_page')!.value, rs.find((x) => x.id === 'error_page')!.retried], [1, true]);
  assert.equal(rs.find((x) => x.id === 'heap')!.retried, undefined);
});

test('HTTP-Fehler werden nicht wiederholt', async () => {
  const s = await setup(authorRoutes(), { ...publishRoutes, [MISSING_PAGE]: { status: 500, body: 'x' } });
  await runSlow(s.ctx);
  const tries = s.p.log.filter((l) => l === `GET ${MISSING_PAGE}`).length;
  await s.close();
  assert.equal(tries, 1);
});

test('runFast: vpn = 1 bei TCP-Verbindung, ohne HTTP-Anfrage an den Author', async () => {
  const s = await setup(authorRoutes(), publishRoutes);
  const r = await tcpReach(s.a.url);
  await s.close();
  assert.equal(r.ok, true);
  assert.equal(s.a.log.length, 0);
});

test('runFast: vpn = 0 mit Grund, wenn der Host nicht erreichbar ist', async () => {
  const s = await setup(authorRoutes(), publishRoutes);
  s.ctx.reach = async () => ({ ok: false, ms: 3000, error: 'ENOTFOUND' });
  const rs = await runFast(s.ctx);
  await s.close();
  const vpn = rs.find((r) => r.id === 'vpn');
  assert.equal(vpn?.value, 0);
  assert.match(vpn?.detail ?? '', /ENOTFOUND/);
  assert.equal(rs.find((r) => r.id === 'author_up')?.value, null);
});

test('VPN getrennt: keine HTTP-Anfragen, alles andere unbekannt (schnell und langsam)', async () => {
  const s = await setup(authorRoutes(), publishRoutes);
  s.ctx.reach = async () => ({ ok: false, ms: 3000, error: 'Timeout nach 3000 ms' });
  const fast = await runFast(s.ctx);
  const slow = await runSlow(s.ctx);
  const ver = await fetchVersions(s.ctx);
  await s.close();
  assert.equal(s.a.log.length + s.p.log.length, 0);
  assert.equal(fast.length, 10);
  assert.deepEqual(fast.filter((r) => r.value !== null).map((r) => r.id), ['vpn']);
  assert.ok(slow.length === 7 && slow.every((r) => r.value === null && /VPN/.test(r.detail ?? '')));
  assert.deepEqual(ver, { aem: null, java: null });
  // Verbindung wieder da: der nächste schnelle Lauf hebt die Sperre auf.
  const s2 = await setup(authorRoutes(), publishRoutes);
  s2.ctx.netDown = true;
  await runFast(s2.ctx);
  await s2.close();
  assert.equal(s2.ctx.netDown, false);
});

test('tcpReach: geschlossener Port ergibt ok=false mit Fehlercode', async () => {
  const s = await setup({}, {});
  const url = s.a.url;
  await s.close();
  const r = await tcpReach(url);
  assert.equal(r.ok, false);
  assert.equal(r.error, 'ECONNREFUSED');
});
