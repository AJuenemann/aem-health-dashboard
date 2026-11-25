import test from 'node:test';
import assert from 'node:assert/strict';
import { diskPercentUsed, enabledAgents, heapPercent, htmlToCells, inactiveBundles, jmxValue, numberAfter, parseQueue } from './parsers.ts';

// Ausschnitte nach den aufgezeichneten Antworten (DEV 25.11.2026).
const HEAP_HTML = `<table><tr><td>Attribute Name</td><td>Attribute Value</td></tr>
<tr><td>HeapMemoryUsage</td><td>java.lang.management.MemoryUsage</td></tr>
<tr><td>committed</td><td>33927725056</td></tr><tr><td>init</td><td>34359738368</td></tr>
<tr><td>max</td><td>33927725056</td></tr><tr><td>used</td><td>16963862528</td></tr>
<tr><td>NonHeapMemoryUsage</td></tr><tr><td>max</td><td>-1</td></tr><tr><td>used</td><td>422471896</td></tr></table>`;
const DISK_HTML = '<td>Attribute Name</td><td>Attribute Value</td><td>Value</td><td>1140543152128</td><td>Operations</td>';
const JOBS_HTML = '<script>var x=1;</script><td>Queued Jobs</td><td>7</td><td>Active Jobs</td><td>0</td>';

test('htmlToCells: ohne Script, Tags und Leerzellen', () => {
  assert.deepEqual(htmlToCells(JOBS_HTML), ['Queued Jobs', '7', 'Active Jobs', '0']);
});

test('heapPercent: nimmt Heap, nicht NonHeap', () => {
  assert.equal(heapPercent(HEAP_HTML), 50);
  assert.equal(heapPercent('<td>nichts</td>'), null);
});

test('jmxValue und diskPercentUsed', () => {
  assert.equal(jmxValue(DISK_HTML), 1140543152128);
  assert.equal(jmxValue('<td>leer</td>'), null);
  assert.equal(diskPercentUsed(25, 100), 75);
  assert.equal(diskPercentUsed(null, 100), null);
  assert.equal(diskPercentUsed(1, 0), null);
});

test('numberAfter: Jobs, fehlende Beschriftung', () => {
  const cells = htmlToCells(JOBS_HTML);
  assert.equal(numberAfter(cells, 'Queued Jobs'), 7);
  assert.equal(numberAfter(cells, 'Gibt es nicht'), null);
});

test('inactiveBundles: Zähler s, Rückfall auf data, kaputt', () => {
  assert.equal(inactiveBundles('{"s":[654,645,9,1,2],"data":[]}'), 3);
  assert.equal(inactiveBundles('{"data":[{"state":"Active"},{"state":"Fragment"},{"state":"Resolved"}]}'), 1);
  assert.equal(inactiveBundles('kaputt'), null);
});

test('enabledAgents: nur aktive, Publish an /bin/receive erkannt', () => {
  const body = JSON.stringify({
    'jcr:content': {},
    publish_x: { 'jcr:content': { enabled: 'true', transportUri: 'http://h/bin/receive?x=1' } },
    scene7: { 'jcr:content': { enabled: true, transportUri: 'scene7:///' } },
    aus: { 'jcr:content': { enabled: 'false', transportUri: 'http://h/bin/receive' } },
  });
  assert.deepEqual(enabledAgents(body), [
    { id: 'publish_x', isPublish: true },
    { id: 'scene7', isPublish: false },
  ]);
  assert.equal(enabledAgents('kaputt'), null);
});

test('parseQueue: blockiert mit Einträgen, leer, ohne Status', () => {
  const blocked = JSON.stringify({ metaData: { queueStatus: { isBlocked: true, isPaused: false } }, queue: [{ time: 200 }, { time: 100 }] });
  assert.deepEqual(parseQueue(blocked), { blocked: true, paused: false, length: 2, oldest: 100 });
  const empty = JSON.stringify({ metaData: { queueStatus: { isBlocked: false, isPaused: false } }, queue: [] });
  assert.deepEqual(parseQueue(empty), { blocked: false, paused: false, length: 0, oldest: null });
  assert.equal(parseQueue('{"x":1}'), null);
});
