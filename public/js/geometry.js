// Reine Geometrie der Messgeräte (kein DOM, unter Node testbar).

export const SWEEP = { start: -120, end: 120 };

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Anteil 0..1 eines Werts auf der Skala. */
export function fraction(value, min, max) {
  if (max <= min) return 0;
  return clamp((value - min) / (max - min), 0, 1);
}

/** Zeigerwinkel in Grad (0 = oben, im Uhrzeigersinn positiv). */
export function valueToAngle(value, min, max, sweep = SWEEP) {
  return sweep.start + fraction(value, min, max) * (sweep.end - sweep.start);
}

/** Punkt auf dem Kreis, Winkel wie oben (0 = oben). */
export function polar(cx, cy, r, deg) {
  const rad = (deg * Math.PI) / 180;
  return [cx + r * Math.sin(rad), cy - r * Math.cos(rad)];
}

const r2 = (n) => Math.round(n * 100) / 100;

/** SVG-Pfad eines Kreisbogens von Winkel a0 nach a1 (im Uhrzeigersinn). */
export function arcPath(cx, cy, r, a0, a1) {
  const [x0, y0] = polar(cx, cy, r, a0);
  const [x1, y1] = polar(cx, cy, r, a1);
  return `M ${r2(x0)} ${r2(y0)} A ${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${r2(x1)} ${r2(y1)}`;
}

/**
 * Farbzonen der Skala aus den Schwellen: ok bis warn, warn bis crit, crit bis Ende.
 * Fallen warn und crit zusammen, entfällt die Warnzone. Ohne Schwellen: nur ok.
 */
export function zonesFor(def) {
  const { min, max } = def.scale;
  const t = def.thresholds;
  if (!t) return [{ from: min, to: max, status: 'ok' }];
  const warn = clamp(t.warn, min, max);
  const crit = clamp(t.crit, min, max);
  return [
    { from: min, to: warn, status: 'ok' },
    { from: warn, to: crit, status: 'warn' },
    { from: crit, to: max, status: 'crit' },
  ].filter((z) => z.to > z.from);
}

/** Status der Zone, in der ein Skalenanteil liegt (für Balkensegmente). */
export function zoneAt(zones, value) {
  const z = zones.find((x) => value >= x.from && value < x.to);
  return (z ?? zones[zones.length - 1]).status;
}

/** Ziffern fürs Rollenzählwerk. Zu große Werte zeigen lauter 9, `over` meldet das. */
export function counterDigits(value, count) {
  const max = 10 ** count - 1;
  const n = clamp(Math.round(value), 0, max);
  return { digits: String(n).padStart(count, '0').split('').map(Number), over: Math.round(value) > max };
}

/** Anzahl leuchtender Segmente. Ein Wert über dem Minimum zeigt mindestens eines. */
export function litSegments(value, min, max, total) {
  const f = fraction(value, min, max);
  if (f === 0) return 0;
  return Math.max(1, Math.round(f * total));
}

/** Zonen des Gesamt-Hauptinstruments (Score 0–100). */
export const SCORE_ZONES = [
  { from: 0, to: 50, status: 'crit' },
  { from: 50, to: 80, status: 'warn' },
  { from: 80, to: 100, status: 'ok' },
];
