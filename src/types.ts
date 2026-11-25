export type Status = 'ok' | 'warn' | 'crit' | 'unknown';
export type Element = 'lamp' | 'gauge' | 'counter' | 'bar' | 'glass';
export type Tempo = 'fast' | 'slow';

export interface CheckDef {
  id: string;
  label: string;
  /** Kurzer Tooltip-Text: was das Instrument zeigt. */
  hint?: string;
  /** Kurzname für das Beschriftungsschild der Lampe. */
  short?: string;
  element: Element;
  unit?: string;
  tempo: Tempo;
  /** Gruppe in der Anzeige (Id aus `groups`). */
  group: string;
  /** Gewicht im Gesamtscore. */
  weight: number;
  /** Ein rotes kritisches Kriterium setzt die Gesamtbewertung auf Rot. */
  critical: boolean;
  /** Ohne Schwellen: Lampe, Wert 1 = ok, 0 = rot. Mit Schwellen: Wert >= warn bzw. >= crit. */
  thresholds?: { warn: number; crit: number };
  /** Anzeigebereich der Skala (Zeiger/Balken/Zählwerk). */
  scale?: { min: number; max: number };
}

export interface ChecksConfig {
  intervals: { fastSeconds: number; slowSeconds: number };
  groups: { id: string; label: string }[];
  checks: CheckDef[];
}

/** Rohmesswert eines Checks. `value: null` = nicht messbar (Fehler, gesperrt, Endpunkt fehlt). */
export interface CheckResult {
  id: string;
  value: number | null;
  detail?: string;
  at: number;
  /** Eine Anfrage dieses Checks musste wiederholt werden (Netzwerkfehler oder Timeout). */
  retried?: boolean;
}

export interface Evaluated extends CheckResult {
  status: Status;
  /** Die letzte Messung schlug fehl; angezeigt wird noch der vorherige Wert. */
  held?: boolean;
  /** Läufe mit Wiederholung in der letzten Stunde (inklusive dieses Laufs). */
  retries1h?: number;
}

export interface Overall {
  status: Status;
  /** 0–100. `null`, solange mindestens ein Kriterium unbekannt ist (kein Score aus Teilwerten). */
  score: number | null;
  counts: Record<Status, number>;
}
