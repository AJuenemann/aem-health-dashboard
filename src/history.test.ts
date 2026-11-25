import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { downsample, History } from './history.ts';
import type { Evaluated } from './types.ts';

const DAY = 86_400_000;
const T0 = Date.parse('2026-11-25T12:00:00Z');
const ev = (id: string, value: number | null): Evaluated => ({ id, value, at: 0, status: value === null ? 'unknown' : 'ok' });
const tmp = () => mkdtempSync(`${tmpdir()}/hist-`);

test('append und read: nur gewünschte Umgebung und ab Zeitpunkt', () => {
  let now = T0;
  const h = new History(tmp(), 7, () => now);
  h.append('dev', 'fast', [ev('a', 1)]);
  now += 60_000;
  h.append('test', 'fast', [ev('a', 2)]);
  now += 60_000;
  h.append('dev', 'fast', [ev('a', 3)]);
  assert.deepEqual(h.read('dev', 0).map((e) => e.r.a![0]), [1, 3]);
  assert.deepEqual(h.read('dev', T0 + 100_000).map((e) => e.r.a![0]), [3]);
});

test('read überspringt defekte Zeilen', () => {
  const dir = tmp();
  const h = new History(dir, 7, () => T0);
  h.append('dev', 'fast', [ev('a', 1)]);
  appendFileSync(`${dir}/2026-11-25.jsonl`, '{halb\n');
  h.append('dev', 'fast', [ev('a', 2)]);
  assert.equal(h.read('dev', 0).length, 2);
});

test('prune: löscht nur Dateien außerhalb der 7 Tage', () => {
  const dir = tmp();
  for (const d of ['2026-11-10', '2026-11-17', '2026-11-18', '2026-11-25']) writeFileSync(`${dir}/${d}.jsonl`, '');
  writeFileSync(`${dir}/notiz.txt`, '');
  const h = new History(dir, 7, () => T0);
  assert.equal(h.prune(), 2); // 11-10 und 11-17 (T0 - 7 Tage = 11-18)
  assert.ok(existsSync(`${dir}/2026-11-18.jsonl`) && existsSync(`${dir}/2026-11-25.jsonl`) && existsSync(`${dir}/notiz.txt`));
  assert.ok(!existsSync(`${dir}/2026-11-10.jsonl`));
});

test('read: Tagesdateien über Tagesgrenze', () => {
  let now = T0 - DAY;
  const h = new History(tmp(), 7, () => now);
  h.append('dev', 'fast', [ev('a', 1)]);
  now = T0;
  h.append('dev', 'fast', [ev('a', 2)]);
  assert.equal(h.read('dev', T0 - DAY - 1000).length, 2);
});

test('downsample: Mittelwert, Lücken bleiben Lücken, kurze Reihen unverändert', () => {
  const pts: [number, number | null][] = [[1, 10], [2, 20], [3, null], [4, null], [5, 5]];
  assert.equal(downsample(pts, 10), pts);
  assert.deepEqual(downsample(pts, 3), [[2, 15], [4, null], [5, 5]]);
});

test('series: Punkte eines Checks', () => {
  const h = new History(tmp(), 7, () => T0);
  h.append('dev', 'fast', [ev('a', 5), ev('b', 9)]);
  assert.deepEqual(h.series('dev', 'a', 0), [[T0, 5]]);
  assert.deepEqual(h.series('dev', 'fehlt', 0), []);
});
