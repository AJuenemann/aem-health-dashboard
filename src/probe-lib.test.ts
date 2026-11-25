import test from 'node:test';
import assert from 'node:assert/strict';
import { summarize, formatBytes, parseProbeArgs, renderTable } from './probe-lib.ts';

test('summarize: JSON-Objekt, Array, HTML, leer, kaputt', () => {
  assert.equal(summarize('{"a":1,"b":2}'), '{a,b} (2 Schlüssel)');
  assert.equal(summarize('[1,2,3]'), 'Array[3]');
  assert.equal(summarize('<html><title> Hallo </title></html>'), 'HTML „Hallo“');
  assert.equal(summarize(''), '(leer)');
  assert.equal(summarize('{kaputt'), 'ungültiges JSON');
});

test('summarize: kürzt lange Schlüssellisten', () => {
  const o = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`k${i}`, i]));
  assert.match(summarize(JSON.stringify(o)), /,…\} \(9 Schlüssel\)$/);
});

test('formatBytes', () => {
  assert.equal(formatBytes(10), '10 B');
  assert.equal(formatBytes(2048), '2.0 KB');
});

test('parseProbeArgs: verlangt --env', () => {
  assert.deepEqual(parseProbeArgs(['--env', 'dev', '--save']), { env: 'dev', save: true });
  assert.throws(() => parseProbeArgs([]));
  assert.throws(() => parseProbeArgs(['--env', '--save']));
});

test('renderTable richtet Spalten aus', () => {
  assert.equal(renderTable([['a', 'bb'], ['ccc', 'd']]), 'a    bb\nccc  d ');
});
