// Reine Logik des Dashboards: kein DOM, unter Node testbar (logic.test.ts).

export const STATUS_TEXT = { ok: 'In Ordnung', warn: 'Warnung', crit: 'Kritisch', unknown: 'Unbekannt' };
/** Formsymbol je Status: Status steht nie nur als Farbe da. */
export const STATUS_ICON = { ok: '●', warn: '▲', crit: '✖', unknown: '?' };

const nf = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });

/** Anzeigewert eines Checks, z. B. "1.234 ms", "52,3 %", "Ja". */
export function formatValue(def, value) {
  if (value === null || value === undefined) return '–';
  if (def.element === 'lamp') return value >= 1 ? 'OK' : 'Fehler';
  return `${nf.format(value)}${def.unit ? ` ${def.unit}` : ''}`;
}

/** Daten gelten als veraltet, wenn der letzte Lauf länger als `factor` Intervalle zurückliegt. */
export function isStale(updatedAt, now, intervalSeconds, factor = 3) {
  if (updatedAt === null || updatedAt === undefined) return true;
  return now - updatedAt > intervalSeconds * 1000 * factor;
}

/** "vor 12 s", "vor 3 min", "vor 2 h". */
export function relTime(ms, now) {
  if (ms === null || ms === undefined) return 'noch nie';
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return `vor ${s} s`;
  if (s < 3600) return `vor ${Math.round(s / 60)} min`;
  return `vor ${Math.round(s / 3600)} h`;
}

/** Checks nach Gruppen in der Reihenfolge von `groups`. Gruppen ohne Checks entfallen. */
export function groupChecks(checks, groups) {
  return groups
    .map((g) => ({ ...g, checks: checks.filter((c) => c.def.group === g.id) }))
    .filter((g) => g.checks.length > 0);
}

/** Ältester Stand aller Takte, null wenn einer fehlt. Für das Banner "Daten veraltet". */
export function staleness(env, intervals, now) {
  const fast = isStale(env.updatedAt.fast, now, intervals.fastSeconds);
  const slow = isStale(env.updatedAt.slow, now, intervals.slowSeconds);
  return { fast, slow, any: fast || slow };
}

/** Statuswort der Gesamtbewertung: bei Status ok deutlicher als "In Ordnung", bei Teilmessung "Unvollständig". */
export function overallWord(overall) {
  if (overall.status === 'ok') return 'Alles einwandfrei';
  if (overall.status === 'unknown' && overall.counts && overall.counts.unknown < Object.values(overall.counts).reduce((a, b) => a + b, 0)) return 'Unvollständig';
  return STATUS_TEXT[overall.status];
}

/** Hinweis zu Wiederholungen und Ausfällen einer Messung. Ab RETRY_ALERT Läufen je Stunde: genauer prüfen. */
export const RETRY_ALERT = 3;
export function retryNote(check) {
  const parts = [];
  if (check.held) parts.push('Letzte Messung fehlgeschlagen, zeigt den vorherigen Wert.');
  if (check.retried) parts.push('↻ Wiederholt angefragt.');
  if (check.retries1h >= RETRY_ALERT) parts.push(`${check.retries1h}× in der letzten Stunde: bitte genauer prüfen.`);
  return parts.join(' ');
}

/** "Score 87" oder, solange Kriterien unbekannt sind, "Score nicht berechenbar". */
export const scoreText = (overall) => (overall.score === null ? 'Score nicht berechenbar' : `Score ${overall.score}`);

/** Hinweis zu unbekannten Kriterien (leer, wenn alle bekannt sind). */
export function unknownHint(counts) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (!counts.unknown) return '';
  if (counts.unknown === total) return 'Keine Messung möglich. Prüfe Verbindung und Zugangsdaten.';
  return `${counts.unknown} von ${total} Kriterien unbekannt. Ohne vollständige Messung gibt es keinen Score.`;
}

/** Erklärt Gesamt-Warnung bei grünem Score: ein einzelnes Kriterium zählt nur anteilig in den Score, löst aber die Warnung aus. */
export function warnHint(overall) {
  const { warn = 0, crit = 0, unknown = 0 } = overall.counts ?? {};
  const n = warn + crit;
  if (overall.status !== 'warn' || unknown || !n || overall.score === null || overall.score < 80) return '';
  return `${n} ${n === 1 ? 'Kriterium ist' : 'Kriterien sind'} nicht in Ordnung. Der Score gewichtet das nur anteilig, die Warnung bleibt.`;
}

/** Gesamttext für Screenreader: "DEV: Kritisch, Score 30 von 100". */
export function overallText(env) {
  return `${env.label}: ${overallWord(env.overall)}, ${env.overall.score === null ? 'Score nicht berechenbar' : `Score ${env.overall.score} von 100`}`;
}
