import test from 'node:test';
import assert from 'node:assert/strict';
import { createLoop, type Timers } from './scheduler.ts';

/** Fake-Uhr: Timer feuern nur, wenn der Test die Zeit vorschiebt. */
function fakeTimers() {
  let now = 0;
  const queue: { at: number; fn: () => void; id: number }[] = [];
  let seq = 0;
  const timers: Timers = {
    setTimeout(fn, ms) {
      const id = ++seq;
      queue.push({ at: now + ms, fn, id });
      return id;
    },
    clearTimeout(h) {
      const i = queue.findIndex((q) => q.id === h);
      if (i >= 0) queue.splice(i, 1);
    },
  };
  return {
    timers,
    pending: () => queue.length,
    /** Schiebt die Zeit vor und lässt Promise-Folgen ablaufen. */
    async advance(ms: number) {
      const end = now + ms;
      for (;;) {
        queue.sort((a, b) => a.at - b.at);
        const t = queue[0];
        if (!t || t.at > end) break;
        queue.shift();
        now = t.at;
        t.fn();
        await new Promise((r) => setImmediate(r));
      }
      now = end;
    },
  };
}

test('Lauf im Intervall, ohne Versatz (jitter 0)', async () => {
  const c = fakeTimers();
  let runs = 0;
  createLoop({ run: async () => void runs++, intervalMs: 1000, jitter: 0, timers: c.timers }).start();
  await c.advance(0);
  assert.equal(runs, 1);
  await c.advance(999);
  assert.equal(runs, 1);
  await c.advance(1);
  assert.equal(runs, 2);
  await c.advance(3000);
  assert.equal(runs, 5);
});

test('Überlappungsschutz: nächster Lauf erst nach Ende des langen Laufs', async () => {
  const c = fakeTimers();
  let starts = 0;
  let release: () => void = () => {};
  createLoop({
    run: () => { starts++; return new Promise<void>((r) => { release = r; }); },
    intervalMs: 100,
    jitter: 0,
    timers: c.timers,
  }).start();
  await c.advance(10_000);
  assert.equal(starts, 1, 'während der Lauf hängt, startet kein zweiter');
  release();
  await new Promise((r) => setImmediate(r)); // Lauf endet, nächster Timer wird gesetzt
  await c.advance(100);
  assert.equal(starts, 2);
});

test('Initialversatz und Jitter-Grenzen', async () => {
  const c = fakeTimers();
  const at: number[] = [];
  let t = 0;
  const origSet = c.timers.setTimeout.bind(c.timers);
  c.timers.setTimeout = (fn, ms) => { at.push(ms); return origSet(fn, ms); };
  createLoop({ run: async () => void t++, intervalMs: 1000, initialDelayMs: 250, jitter: 0.2, random: () => 1, timers: c.timers }).start();
  await c.advance(250);
  await c.advance(1100);
  assert.equal(at[0], 250);
  assert.equal(at[1], 1100, 'random=1 → +10 %');
});

test('Fehler im Lauf stoppen die Schleife nicht; stop() beendet sie', async () => {
  const c = fakeTimers();
  let runs = 0;
  const errors: unknown[] = [];
  const loop = createLoop({
    run: async () => { runs++; throw new Error('kaputt'); },
    intervalMs: 100,
    jitter: 0,
    timers: c.timers,
    onError: (e) => errors.push(e),
  });
  loop.start();
  await c.advance(250);
  assert.equal(runs, 3);
  assert.equal(errors.length, 3);
  loop.stop();
  await c.advance(1000);
  assert.equal(runs, 3);
  assert.equal(c.pending(), 0);
});
