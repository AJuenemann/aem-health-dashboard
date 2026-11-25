// Reine Plot-Logik der Schreiber-Kurve (kein DOM, unter Node testbar).

const r2 = (n) => Math.round(n * 100) / 100;

/**
 * Zerlegt Punkte `[t, wert|null]` in zusammenhängende Linienstücke (Lücken bei `null`)
 * und bildet sie auf Pixel ab. Ein Stück mit nur einem Punkt wird als Punkt gezeichnet.
 */
export function buildSegments(points, { t0, t1, min, max, left, top, width, height }) {
  const x = (t) => left + (t1 === t0 ? 0 : ((t - t0) / (t1 - t0)) * width);
  const y = (v) => top + height - ((Math.min(Math.max(v, min), max) - min) / (max - min)) * height;
  const segments = [];
  let cur = [];
  for (const [t, v] of points) {
    if (v === null) {
      if (cur.length) segments.push(cur);
      cur = [];
    } else {
      cur.push([r2(x(t)), r2(y(v))]);
    }
  }
  if (cur.length) segments.push(cur);
  return segments;
}

/** SVG-Pfad eines Linienstücks. */
export const segmentPath = (seg) => seg.map(([px, py], i) => `${i ? 'L' : 'M'} ${px} ${py}`).join(' ');

/** Y-Pixel eines Werts (für Schwellenlinien und Zonen). */
export function yOf(value, { min, max, top, height }) {
  return r2(top + height - ((Math.min(Math.max(value, min), max) - min) / (max - min)) * height);
}

/** Kennzahlen der Messwerte (ohne Lücken). `null`, wenn keine Werte da sind. */
export function summary(points) {
  const v = points.map((p) => p[1]).filter((x) => x !== null);
  if (v.length === 0) return null;
  return { min: Math.min(...v), max: Math.max(...v), avg: v.reduce((a, b) => a + b, 0) / v.length, last: v[v.length - 1], count: v.length };
}

/** Gleichmäßig verteilte Zeitmarken inkl. Anfang und Ende. */
export function timeTicks(t0, t1, count = 5) {
  return Array.from({ length: count }, (_, i) => t0 + ((t1 - t0) * i) / (count - 1));
}

/** Obere Achsengrenze: Skalenende, bei größeren Messwerten das nächste „runde“ Vielfache. */
export function axisMax(scaleMax, dataMax) {
  if (dataMax <= scaleMax) return scaleMax;
  const step = 10 ** Math.floor(Math.log10(dataMax));
  return Math.ceil(dataMax / step) * step;
}
