import test from 'node:test';
import assert from 'node:assert/strict';
import { MISSING_PAGE } from './checks.ts';
import { loadChecks } from './evaluate.ts';
import { AemClient } from './aem-client.ts';
import { startFakeAem } from './fake-aem.ts';
import { Monitor } from './monitor.ts';

test('Entprellung: erste Fehlmessung zeigt den alten Wert, die zweite in Folge "unbekannt"', async () => {
  const a = await startFakeAem({ '/libs/granite/core/content/login.html': { body: 'login' } });
  const p = await startFakeAem({ [MISSING_PAGE]: { status: 404, body: '<title>Fehlerseite 404</title>' } });
  const cfg = { id: 'dev', label: 'DEV', baseUrl: a.url, publishUrl: p.url };
  const m = new Monitor([cfg], loadChecks(), { user: 'u', password: 'p' }, () => ({
    author: new AemClient({ baseUrl: a.url, credentials: { user: 'u', password: 'p' }, timeoutMs: 150 }),
    publish: new AemClient({ baseUrl: p.url, timeoutMs: 150 }),
  }));
  const err = () => m.state()[0]!.checks.find((c) => c.def.id === 'error_page')!;
  const step = async (delayMs: number) => {
    p.routes.get(MISSING_PAGE)!.delayMs = delayMs;
    await m.runOnce();
    return err();
  };

  assert.deepEqual([(await step(0)).status, err().held], ['ok', undefined]);
  const held = await step(600);
  assert.deepEqual([held.status, held.value, held.held, held.retried], ['ok', 1, true, true]);
  const second = await step(600);
  assert.deepEqual([second.status, second.held], ['unknown', undefined]);
  assert.ok((second.retries1h ?? 0) >= 2);
  const back = await step(0);
  assert.deepEqual([back.status, back.held], ['ok', undefined]);
  await a.close();
  await p.close();
});

test('Wartungsmodus: keine Anfragen, alle Kriterien unbekannt mit Hinweis', async () => {
  const a = await startFakeAem({});
  const p = await startFakeAem({});
  const cfg = { id: 'dev', label: 'DEV', baseUrl: a.url, publishUrl: p.url, maintenance: 'Upgrade' };
  const m = new Monitor([cfg], loadChecks(), { user: 'u', password: 'p' });
  await m.runOnce();
  m.start();
  m.stop();
  const s = m.state()[0]!;
  assert.equal(s.maintenance, 'Upgrade');
  assert.equal(s.checks[0]!.detail, 'In Wartung, nicht geprüft.');
  assert.equal(a.log.length + p.log.length, 0);
  await a.close();
  await p.close();
});

test('Versionen: AEM, Java und Oak werden gelesen, ein Fehlversuch behält den letzten Wert', async () => {
  const PRODUCT = '/system/console/status-productinfo.json';
  const product = (v: string) => `["Installed Products","  Adobe Experience Manager (${v})"]`;
  const a = await startFakeAem({
    '/libs/granite/core/content/login.html': { body: 'login' },
    [PRODUCT]: { auth: true, body: product('6.5.25.0') },
    '/system/console/jmx/java.lang%3Atype%3DRuntime': { auth: true, body: '<td>java.version</td><td>1.8.0_513</td><td>user.dir</td>' },
    '/system/console/bundles.json': { auth: true, body: '{"s":[2,2,0,0,0],"data":[{"symbolicName":"org.apache.jackrabbit.oak-core","version":"1.22.24","state":"Active"}]}' },
  });
  const p = await startFakeAem({});
  const cfg = { id: 'dev', label: 'DEV', baseUrl: a.url, publishUrl: p.url };
  const m = new Monitor([cfg], loadChecks(), { user: 'u', password: 'p' }, () => ({
    author: new AemClient({ baseUrl: a.url, credentials: { user: 'u', password: 'p' }, timeoutMs: 150 }),
    publish: new AemClient({ baseUrl: p.url, timeoutMs: 150 }),
  }));
  assert.deepEqual(m.state()[0]!.versions, { aem: null, java: null, oak: null });
  await m.runOnce();
  assert.deepEqual(m.state()[0]!.versions, { aem: '6.5.25.0', java: '1.8.0_513', oak: '1.22.24' });
  a.routes.get(PRODUCT)!.status = 500;
  a.routes.get('/system/console/bundles.json')!.status = 500;
  await m.runOnce();
  assert.deepEqual(m.state()[0]!.versions, { aem: '6.5.25.0', java: '1.8.0_513', oak: '1.22.24' });
  Object.assign(a.routes.get(PRODUCT)!, { status: 200, body: product('6.5.26.0') });
  await m.runOnce();
  assert.equal(m.state()[0]!.versions.aem, '6.5.26.0');
  await a.close();
  await p.close();
});
