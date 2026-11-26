/** Reine Parser für die AEM-Antworten (Formate siehe docs/ENDPOINTS.md). Werfen nie: unlesbar = null. */

/** HTML → Liste nichtleerer Textzellen (ohne Script/Style). */
export function htmlToCells(html: string): string[] {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<[^>]+>/g, '|')
    .split('|')
    .map((c) => c.replace(/&nbsp;/g, ' ').trim())
    .filter(Boolean);
}

const num = (s: string | undefined): number | null => {
  if (s === undefined || !/^-?\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
};

/** Zahl hinter einer Beschriftung (`Queued Jobs|0`). Erste Fundstelle. */
export function numberAfter(cells: string[], label: string, from = 0): number | null {
  const i = cells.indexOf(label, from);
  return i < 0 ? null : num(cells[i + 1]);
}

/** JMX-Konsole, einfaches Attribut (`Attribute Value|Value|<Zahl>`). */
export function jmxValue(html: string): number | null {
  const cells = htmlToCells(html);
  const start = cells.indexOf('Attribute Value');
  return start < 0 ? null : numberAfter(cells, 'Value', start + 1);
}

/** JMX `java.lang:type=Memory`: Heap-Auslastung in Prozent. */
export function heapPercent(html: string): number | null {
  const cells = htmlToCells(html);
  const i = cells.indexOf('HeapMemoryUsage');
  if (i < 0) return null;
  const max = numberAfter(cells, 'max', i);
  const used = numberAfter(cells, 'used', i);
  if (max === null || used === null || max <= 0) return null;
  return (used / max) * 100;
}

/** Plattenbelegung in Prozent aus freiem und gesamtem Platz. */
export function diskPercentUsed(usable: number | null, total: number | null): number | null {
  if (usable === null || total === null || total <= 0) return null;
  return (1 - usable / total) * 100;
}

/** `bundles.json`: Anzahl nicht aktiver Bundles (`s` = [gesamt, aktiv, fragment, resolved, installed]). */
export function inactiveBundles(body: string): number | null {
  try {
    const j = JSON.parse(body) as { s?: unknown; data?: { state?: string }[] };
    if (Array.isArray(j.s) && j.s.length >= 5) return Number(j.s[3]) + Number(j.s[4]);
    if (Array.isArray(j.data)) return j.data.filter((b) => b.state !== 'Active' && b.state !== 'Fragment').length;
  } catch {
    /* unlesbar */
  }
  return null;
}

export interface AgentInfo {
  id: string;
  isPublish: boolean;
}

/** `agents.author.2.json`: aktive Agents; Publish-Agent = `transportUri` mit `/bin/receive`. */
export function enabledAgents(body: string): AgentInfo[] | null {
  try {
    const j = JSON.parse(body) as Record<string, unknown>;
    const out: AgentInfo[] = [];
    for (const [id, v] of Object.entries(j)) {
      const c = (v as { 'jcr:content'?: { enabled?: unknown; transportUri?: unknown } } | null)?.['jcr:content'];
      if (!c || String(c.enabled) !== 'true') continue;
      out.push({ id, isPublish: String(c.transportUri ?? '').includes('/bin/receive') });
    }
    return out;
  } catch {
    return null;
  }
}

export interface QueueInfo {
  blocked: boolean;
  paused: boolean;
  length: number;
  /** Zeitstempel (ms) des ältesten Eintrags, null bei leerer Queue. */
  oldest: number | null;
}

/** `jcr:content.queue.json`. Die AEM-Liste endet bei 50 Einträgen, `length` ist dann "mindestens". */
export function parseQueue(body: string): QueueInfo | null {
  try {
    const j = JSON.parse(body) as {
      metaData?: { queueStatus?: { isBlocked?: boolean; isPaused?: boolean } };
      queue?: { time?: number }[];
    };
    const s = j.metaData?.queueStatus;
    if (!s) return null;
    const times = (j.queue ?? []).map((e) => e.time).filter((t): t is number => typeof t === 'number');
    return {
      blocked: s.isBlocked === true,
      paused: s.isPaused === true,
      length: j.queue?.length ?? 0,
      oldest: times.length ? Math.min(...times) : null,
    };
  } catch {
    return null;
  }
}

/** AEM-Version aus `status-productinfo.json` ("Adobe Experience Manager (6.5.25.0)"), sonst null. */
export function aemVersion(body: string): string | null {
  return /Adobe Experience Manager \(([^)]+)\)/.exec(body)?.[1]?.trim() || null;
}

/** JMX `java.lang:type=Runtime`: Java-Version aus den System-Properties (`java.version|1.8.0_513`). */
export function javaVersion(html: string): string | null {
  const cells = htmlToCells(html);
  const i = cells.indexOf('java.version');
  return i < 0 ? null : cells[i + 1] || null;
}

/** `bundles.json`: Version des Oak-Kerns (Bundle `org.apache.jackrabbit.oak-core`). */
export function oakVersion(body: string): string | null {
  try {
    const j = JSON.parse(body) as { data?: { symbolicName?: string; version?: string }[] };
    return j.data?.find((b) => b.symbolicName === 'org.apache.jackrabbit.oak-core')?.version || null;
  } catch {
    return null;
  }
}
