import test from 'node:test';
import assert from 'node:assert/strict';
import { arcPath, counterDigits, fraction, litSegments, polar, valueToAngle, zoneAt, zonesFor } from './geometry.js';

const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test('valueToAngle: Anfang, Mitte, Ende, außerhalb wird begrenzt', () => {
  assert.equal(valueToAngle(0, 0, 100), -120);
  assert.equal(valueToAngle(50, 0, 100), 0);
  assert.equal(valueToAngle(100, 0, 100), 120);
  assert.equal(valueToAngle(-5, 0, 100), -120);
  assert.equal(valueToAngle(500, 0, 100), 120);
  assert.equal(valueToAngle(5, 5, 5), -120, 'leere Skala bricht nicht');
});

test('fraction: Skala mit Offset', () => {
  assert.equal(fraction(15, 10, 20), 0.5);
});

test('polar: 0° oben, 90° rechts, 180° unten', () => {
  const [x0, y0] = polar(100, 100, 10, 0);
  close(x0, 100); close(y0, 90);
  const [x1, y1] = polar(100, 100, 10, 90);
  close(x1, 110); close(y1, 100);
  const [, y2] = polar(100, 100, 10, 180);
  close(y2, 110);
});

test('arcPath: Großbogen-Flag erst über 180°', () => {
  assert.match(arcPath(100, 100, 70, -120, 0), /A 70 70 0 0 1 /);
  assert.match(arcPath(100, 100, 70, -120, 120), /A 70 70 0 1 1 /);
});

test('zonesFor: drei Zonen, ohne Schwellen nur ok, warn=crit ohne Warnzone', () => {
  const def = { scale: { min: 0, max: 100 }, thresholds: { warn: 80, crit: 92 } };
  assert.deepEqual(zonesFor(def).map((z: { status: string }) => z.status), ['ok', 'warn', 'crit']);
  assert.deepEqual(zonesFor({ scale: { min: 0, max: 1 } }), [{ from: 0, to: 1, status: 'ok' }]);
  const counter = { scale: { min: 0, max: 5 }, thresholds: { warn: 1, crit: 1 } };
  assert.deepEqual(zonesFor(counter).map((z: { status: string }) => z.status), ['ok', 'crit']);
});

test('zonesFor: Schwelle jenseits der Skala wird begrenzt', () => {
  const z = zonesFor({ scale: { min: 0, max: 5000 }, thresholds: { warn: 2500, crit: 5000 } });
  assert.deepEqual(z.map((x: { status: string }) => x.status), ['ok', 'warn']);
});

test('zoneAt: Grenze gehört zur oberen Zone, Ende zur letzten', () => {
  const zones = zonesFor({ scale: { min: 0, max: 100 }, thresholds: { warn: 80, crit: 92 } });
  assert.equal(zoneAt(zones, 79.9), 'ok');
  assert.equal(zoneAt(zones, 80), 'warn');
  assert.equal(zoneAt(zones, 92), 'crit');
  assert.equal(zoneAt(zones, 100), 'crit');
});

test('counterDigits: Auffüllen, Runden, Überlauf', () => {
  assert.deepEqual(counterDigits(7, 3), { digits: [0, 0, 7], over: false });
  assert.deepEqual(counterDigits(4.6, 2), { digits: [0, 5], over: false });
  assert.deepEqual(counterDigits(1234, 3), { digits: [9, 9, 9], over: true });
  assert.deepEqual(counterDigits(-3, 2), { digits: [0, 0], over: false });
});

test('litSegments: 0 = aus, kleiner Wert = mindestens eins', () => {
  assert.equal(litSegments(0, 0, 100, 20), 0);
  assert.equal(litSegments(1, 0, 100, 20), 1);
  assert.equal(litSegments(50, 0, 100, 20), 10);
  assert.equal(litSegments(999, 0, 100, 20), 20);
});
