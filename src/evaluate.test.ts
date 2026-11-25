import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, loadChecks, overall, statusOf } from './evaluate.ts';
import type { CheckDef, Evaluated } from './types.ts';

const gauge: CheckDef = { id: 'g', label: 'g', element: 'gauge', tempo: 'fast', group: 'g', weight: 2, critical: false, thresholds: { warn: 10, crit: 20 } };
const lamp: CheckDef = { id: 'l', label: 'l', element: 'lamp', tempo: 'fast', group: 'g', weight: 3, critical: true };

test('statusOf: Grenzwerte sind inklusive', () => {
  assert.equal(statusOf(gauge, 9.99), 'ok');
  assert.equal(statusOf(gauge, 10), 'warn');
  assert.equal(statusOf(gauge, 19), 'warn');
  assert.equal(statusOf(gauge, 20), 'crit');
});

test('statusOf: Lampe 1 = ok, 0 = rot, null/NaN = unknown', () => {
  assert.equal(statusOf(lamp, 1), 'ok');
  assert.equal(statusOf(lamp, 0), 'crit');
  assert.equal(statusOf(lamp, null), 'unknown');
  assert.equal(statusOf(gauge, Number.NaN), 'unknown');
});

const ev = (def: CheckDef, value: number | null): [string, Evaluated] => [def.id, evaluate(def, { id: def.id, value, at: 0 })];

test('overall: alles ok = 100, ok', () => {
  const o = overall([gauge, lamp], new Map([ev(gauge, 1), ev(lamp, 1)]));
  assert.deepEqual([o.status, o.score], ['ok', 100]);
});

test('overall: kritisches Kriterium rot = Gesamt rot, Score höchstens 30', () => {
  const o = overall([gauge, lamp], new Map([ev(gauge, 1), ev(lamp, 0)]));
  assert.equal(o.status, 'crit');
  assert.ok(o.score !== null && o.score <= 30);
});

test('overall: nicht kritisches Rot = Gesamt gelb, Gewichtung zählt', () => {
  const o = overall([gauge, lamp], new Map([ev(gauge, 25), ev(lamp, 1)]));
  assert.equal(o.status, 'warn');
  assert.equal(o.score, 60); // (2*0 + 3*1) / 5
});

test('overall: unbekanntes Kriterium = kein Score, alle unbekannt = unknown', () => {
  const some = overall([gauge, lamp], new Map([ev(gauge, 1), ev(lamp, null)]));
  assert.deepEqual([some.status, some.score, some.counts.unknown], ['unknown', null, 1]);
  const none = overall([gauge, lamp], new Map());
  assert.deepEqual([none.status, none.score], ['unknown', null]);
  // Bekanntes Rot bleibt trotz unbekannter Werte sichtbar, aber ohne Score.
  const red = overall([gauge, lamp], new Map([ev(gauge, 1), ev(lamp, 0)]));
  assert.equal(red.status, 'crit');
  const redUnknown = overall([gauge, lamp, { ...gauge, id: 'g2' }], new Map([ev(gauge, 1), ev(lamp, 0), ev({ ...gauge, id: 'g2' }, null)]));
  assert.deepEqual([redUnknown.status, redUnknown.score], ['crit', null]);
});

test('checks.json: Ids eindeutig, Schwellen und Skalen stimmig', () => {
  const { checks, intervals, groups } = loadChecks();
  assert.equal(new Set(checks.map((c) => c.id)).size, checks.length);
  for (const c of checks) assert.ok(groups.some((g) => g.id === c.group), `${c.id}: Gruppe "${c.group}" fehlt`);
  assert.ok(intervals.fastSeconds < intervals.slowSeconds);
  for (const c of checks) {
    assert.ok(c.weight > 0, c.id);
    if (c.thresholds) assert.ok(c.thresholds.warn <= c.thresholds.crit, c.id);
    if (c.element !== 'lamp') assert.ok(c.scale && c.scale.min < c.scale.max, `${c.id}: Skala fehlt`);
  }
});
