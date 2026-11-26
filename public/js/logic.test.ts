import test from 'node:test';
import assert from 'node:assert/strict';
import { formatValue, groupChecks, isStale, overallText, overallWord, retryNote, unknownHint, warnHint, relTime, staleness } from './logic.js';

const gauge = { id: 'a', label: 'A', element: 'gauge', unit: 'ms', group: 'x' };
const lamp = { id: 'l', label: 'L', element: 'lamp', group: 'y' };

test('formatValue: Einheit, Dezimal (de), Lampe, fehlender Wert', () => {
  assert.equal(formatValue(gauge, 1234), '1.234 ms');
  assert.equal(formatValue({ ...gauge, unit: '%' }, 52.34), '52,3 %');
  assert.equal(formatValue(lamp, 1), 'OK');
  assert.equal(formatValue(lamp, 0), 'Fehler');
  assert.equal(formatValue(gauge, null), '–');
});

test('isStale: Grenze bei 3 Intervallen, nie gelaufen = veraltet', () => {
  assert.equal(isStale(1000, 1000 + 90_000, 30), false);
  assert.equal(isStale(1000, 1000 + 90_001, 30), true);
  assert.equal(isStale(null, 5, 30), true);
});

test('staleness: schnell und langsam getrennt', () => {
  const env = { updatedAt: { fast: 100_000, slow: 0 } };
  const r = staleness(env, { fastSeconds: 30, slowSeconds: 300 }, 100_000 + 60_000);
  assert.deepEqual(r, { fast: false, slow: false, any: false });
  assert.equal(staleness(env, { fastSeconds: 30, slowSeconds: 300 }, 1_000_000).any, true);
});

test('relTime', () => {
  assert.equal(relTime(null, 0), 'noch nie');
  assert.equal(relTime(0, 12_000), 'vor 12 s');
  assert.equal(relTime(0, 180_000), 'vor 3 min');
  assert.equal(relTime(0, 7_200_000), 'vor 2 h');
  assert.equal(relTime(5000, 1000), 'vor 0 s');
});

test('groupChecks: Reihenfolge der Gruppen, leere Gruppen entfallen', () => {
  const checks = [{ def: lamp }, { def: gauge }];
  const g = groupChecks(checks, [{ id: 'y', label: 'Y' }, { id: 'z', label: 'Z' }, { id: 'x', label: 'X' }]);
  assert.deepEqual(g.map((x: { id: string; checks: unknown[] }) => [x.id, x.checks.length]), [['y', 1], ['x', 1]]);
});

test('overallText', () => {
  assert.equal(overallText({ label: 'DEV', overall: { status: 'crit', score: 30 } }), 'DEV: Kritisch, Score 30 von 100');
});

test('Gesamttext bei unbekannten Kriterien', () => {
  const counts = (o: number, u: number) => ({ ok: o, warn: 0, crit: 0, unknown: u });
  assert.equal(overallWord({ status: 'unknown', score: null, counts: counts(12, 3) }), 'Unvollständig');
  assert.equal(overallWord({ status: 'unknown', score: null, counts: counts(0, 15) }), 'Unbekannt');
  assert.equal(overallText({ label: 'DEV', overall: { status: 'unknown', score: null, counts: counts(12, 3) } }), 'DEV: Unvollständig, Score nicht berechenbar');
  assert.equal(unknownHint(counts(15, 0)), '');
  assert.match(unknownHint(counts(12, 3)), /^3 von 15 /);
  assert.match(unknownHint(counts(0, 15)), /^Keine Messung/);
});

test('warnHint erklärt Warnung bei grünem Score', () => {
  const o = (status: string, score: number | null, warn: number, unknown = 0) => ({ status, score, counts: { ok: 14, warn, crit: 0, unknown } });
  assert.match(warnHint(o('warn', 94, 1)), /^1 Kriterium ist /);
  assert.equal(warnHint(o('warn', 60, 1)), '');
  assert.equal(warnHint(o('ok', 100, 0)), '');
  assert.equal(warnHint(o('warn', null, 1, 2)), '');
});

test('retryNote: Wiederholung, Ausfall und Häufung', () => {
  assert.equal(retryNote({}), '');
  assert.equal(retryNote({ retried: true, retries1h: 1 }), '↻ Wiederholt angefragt.');
  assert.match(retryNote({ held: true, retried: true }), /^Letzte Messung fehlgeschlagen.*↻/);
  assert.match(retryNote({ retried: true, retries1h: 3 }), /3× in der letzten Stunde: bitte genauer prüfen/);
});
