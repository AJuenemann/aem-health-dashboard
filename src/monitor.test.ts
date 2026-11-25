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
