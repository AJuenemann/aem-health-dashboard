import { appendFileSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import type { Evaluated, Status } from './types.ts';

/**
 * Verlauf als JSONL, eine Datei pro Tag (UTC): `data/history/YYYY-MM-DD.jsonl`.
 * Eine Zeile pro Lauf und Umgebung: `{t, env, tempo, r: {checkId: [wert, status]}}`.
 * Aufbewahrung: `retentionDays` Tage, Aufräumen per `prune()`.
 */
export interface Entry {
  t: number;
  env: string;
  tempo: 'fast' | 'slow';
  r: Record<string, [number | null, Status] | [number | null, Status, string]>;
}

const DAY = 86_400_000;
const dayName = (t: number): string => new Date(t).toISOString().slice(0, 10);

export class History {
  constructor(
    private readonly dir: string,
    private readonly retentionDays = 7,
    private readonly now: () => number = Date.now,
  ) {
    mkdirSync(dir, { recursive: true });
  }

  append(env: string, tempo: 'fast' | 'slow', results: Evaluated[]): void {
    const t = this.now();
    const r: Entry['r'] = {};
    // Drittes Element nur bei Wiederholung: "r" = musste wiederholt werden.
    for (const e of results) r[e.id] = e.retried ? [e.value, e.status, 'r'] : [e.value, e.status];
    const entry: Entry = { t, env, tempo, r };
    appendFileSync(`${this.dir}/${dayName(t)}.jsonl`, `${JSON.stringify(entry)}\n`);
  }

  /** Einträge einer Umgebung ab `sinceMs`, älteste zuerst. Defekte Zeilen werden übersprungen. */
  read(env: string, sinceMs: number): Entry[] {
    const out: Entry[] = [];
    const first = dayName(sinceMs);
    for (const f of this.files().filter((f) => f.slice(0, 10) >= first)) {
      for (const line of readFileSync(`${this.dir}/${f}`, 'utf8').split('\n')) {
        if (!line) continue;
        try {
          const e = JSON.parse(line) as Entry;
          if (e.env === env && e.t >= sinceMs) out.push(e);
        } catch {
          /* halb geschriebene Zeile nach Absturz */
        }
      }
    }
    return out;
  }

  /** Verlauf eines Checks als Punkte `[t, wert|null]`, auf höchstens `maxPoints` verdichtet (Mittelwert je Bucket). */
  series(env: string, id: string, sinceMs: number, maxPoints = 300): [number, number | null][] {
    const pts: [number, number | null][] = [];
    for (const e of this.read(env, sinceMs)) {
      const v = e.r[id];
      if (v) pts.push([e.t, v[0]]);
    }
    return downsample(pts, maxPoints);
  }

  /** Löscht Tagesdateien, die älter als die Aufbewahrung sind. */
  prune(): number {
    const oldest = dayName(this.now() - this.retentionDays * DAY);
    const stale = this.files().filter((f) => f.slice(0, 10) < oldest);
    for (const f of stale) rmSync(`${this.dir}/${f}`);
    return stale.length;
  }

  private files(): string[] {
    return readdirSync(this.dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)).sort();
  }
}

/** Bucket-Mittelwert. Ein Bucket aus nur `null` bleibt `null` (Lücke), sonst zählen nur Zahlen. */
export function downsample(pts: [number, number | null][], max: number): [number, number | null][] {
  if (pts.length <= max) return pts;
  const size = Math.ceil(pts.length / max);
  const out: [number, number | null][] = [];
  for (let i = 0; i < pts.length; i += size) {
    const b = pts.slice(i, i + size);
    const nums = b.map((p) => p[1]).filter((v): v is number => v !== null);
    out.push([b[Math.floor(b.length / 2)]![0], nums.length ? nums.reduce((a, c) => a + c, 0) / nums.length : null]);
  }
  return out;
}
