import { readFileSync } from 'node:fs';
import { ROOT } from './config.ts';
import type { CheckDef, ChecksConfig, CheckResult, Evaluated, Overall, Status } from './types.ts';

export function loadChecks(file = `${ROOT}config/checks.json`): ChecksConfig {
  return JSON.parse(readFileSync(file, 'utf8')) as ChecksConfig;
}

/** Status eines Messwerts. Höherer Wert = schlechter (Schwellen), Lampen: 1 = ok. */
export function statusOf(def: CheckDef, value: number | null): Status {
  if (value === null || Number.isNaN(value)) return 'unknown';
  const t = def.thresholds;
  if (!t) return value >= 1 ? 'ok' : 'crit';
  if (value >= t.crit) return 'crit';
  if (value >= t.warn) return 'warn';
  return 'ok';
}

export function evaluate(def: CheckDef, r: CheckResult): Evaluated {
  return { ...r, status: statusOf(def, r.value) };
}

const FACTOR: Record<Status, number> = { ok: 1, warn: 0.5, crit: 0, unknown: 0 };
/** Obergrenze des Scores, sobald ein kritisches Kriterium rot ist. */
const CRIT_CAP = 30;

/**
 * Gesamtbewertung. Ist mindestens ein Kriterium unbekannt, gibt es keinen Score (`null`):
 * aus Teilwerten wäre er geschönt. Bekanntes Rot oder Gelb bleibt sichtbar, denn es ist belegt.
 * Sind die bekannten Kriterien alle grün, ist das Ergebnis `unknown` (Anzeige: "Unvollständig").
 * Kritisches Kriterium rot → Gesamt rot und, bei vollständiger Messung, Score höchstens 30.
 * Anderes Rot oder Gelb → Gesamt gelb.
 */
export function overall(defs: CheckDef[], results: Map<string, Evaluated>): Overall {
  const counts: Record<Status, number> = { ok: 0, warn: 0, crit: 0, unknown: 0 };
  let weight = 0;
  let points = 0;
  let criticalRed = false;
  for (const d of defs) {
    const s = results.get(d.id)?.status ?? 'unknown';
    counts[s]++;
    if (s === 'unknown') continue;
    weight += d.weight;
    points += d.weight * FACTOR[s];
    if (s === 'crit' && d.critical) criticalRed = true;
  }
  if (weight === 0) return { status: 'unknown', score: null, counts };
  let score: number | null = Math.round((points / weight) * 100);
  if (criticalRed) score = Math.min(score, CRIT_CAP);
  if (counts.unknown > 0) score = null;
  const known: Status = criticalRed ? 'crit' : counts.crit + counts.warn > 0 ? 'warn' : 'ok';
  const status: Status = known === 'ok' && counts.unknown > 0 ? 'unknown' : known;
  return { status, score, counts };
}
