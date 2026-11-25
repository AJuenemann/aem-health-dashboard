import test from 'node:test';
import assert from 'node:assert/strict';
import { axisMax, buildSegments, segmentPath, summary, timeTicks, yOf } from './plot.js';

const box = { t0: 0, t1: 100, min: 0, max: 10, left: 10, top: 5, width: 100, height: 50 };

test('buildSegments: Abbildung auf Pixel, y nach oben', () => {
  const [seg] = buildSegments([[0, 0], [100, 10]], box);
  assert.deepEqual(seg, [[10, 55], [110, 5]]);
});

test('buildSegments: null trennt Stücke, Einzelpunkt bleibt erhalten', () => {
  const segs = buildSegments([[0, 1], [10, 2], [20, null], [30, 3], [40, null], [50, null], [60, 4], [70, 5]], box);
  assert.deepEqual(segs.map((s: unknown[]) => s.length), [2, 1, 2]);
});

test('buildSegments: Werte außerhalb der Achse werden begrenzt, leere Reihe', () => {
  const [seg] = buildSegments([[0, -5], [50, 99]], box);
  assert.deepEqual(seg!.map((p: number[]) => p[1]), [55, 5]);
  assert.deepEqual(buildSegments([], box), []);
  assert.deepEqual(buildSegments([[7, null]], box), []);
});

test('buildSegments: Zeitraum der Länge 0 teilt nicht durch null', () => {
  const [seg] = buildSegments([[5, 1]], { ...box, t0: 5, t1: 5 });
  assert.equal(seg![0]![0], 10);
});

test('segmentPath und yOf', () => {
  assert.equal(segmentPath([[1, 2], [3, 4]]), 'M 1 2 L 3 4');
  assert.equal(yOf(5, box), 30);
  assert.equal(yOf(99, box), 5);
});

test('summary: Kennzahlen ohne Lücken, leer = null', () => {
  assert.deepEqual(summary([[0, 2], [1, null], [2, 4]]), { min: 2, max: 4, avg: 3, last: 4, count: 2 });
  assert.equal(summary([[0, null]]), null);
});

test('timeTicks und axisMax', () => {
  assert.deepEqual(timeTicks(0, 100, 5), [0, 25, 50, 75, 100]);
  assert.equal(axisMax(100, 80), 100);
  assert.equal(axisMax(100, 130), 200);
  assert.equal(axisMax(5000, 12000), 20000);
});
