import { LockedError, retryScope, type AemClient, type AemResponse } from './aem-client.ts';
import { tcpReach, type Reach } from './reach.ts';
import { aemVersion, diskPercentUsed, enabledAgents, heapPercent, htmlToCells, inactiveBundles, javaVersion, jmxValue, numberAfter, oakVersion, parseQueue } from './parsers.ts';
import type { CheckResult, Versions } from './types.ts';

/** Seiten für Publish-Prüfungen (siehe docs/ENDPOINTS.md). */
export const PUBLISH_PAGE = '/content/zv/de.html';
export const MISSING_PAGE = '/content/zv/de/qa-seite-gibt-es-nicht.html';
const DISK_USABLE = '/system/console/jmx/com.adobe.granite%3Aname%3DDISK_USABLE_SPACE%2Ctype%3DMetrics';
const DISK_TOTAL = '/system/console/jmx/com.adobe.granite%3Aname%3DDISK_TOTAL_SPACE%2Ctype%3DMetrics';

export interface Ctx {
  author: AemClient;
  publish: AemClient;
  now?: () => number;
  /** Verbindungsprobe zum Author-Host (Standard: TCP). Test-Hook. */
  reach?: (baseUrl: string) => Promise<Reach>;
  /** Vom letzten schnellen Lauf gesetzt: Author-Host nicht erreichbar. Dann entfallen alle Anfragen (siehe `NET_DOWN`). */
  netDown?: boolean;
  /** Meldet Versionen, die ein Check nebenbei findet (Oak steckt in bundles.json). */
  onInfo?: (patch: Partial<Versions>) => void;
}

const ok = (r: AemResponse): boolean => r.status === 200;
const describe = (r: AemResponse): string => (r.error ? r.error : `HTTP ${r.status}`);

/** Holt eine Author-Ressource. Netzwerkfehler und Sperre werden zu `null` + Grund, nie zur Ausnahme. */
async function authorGet(ctx: Ctx, path: string): Promise<{ res: AemResponse | null; why: string }> {
  try {
    const res = await ctx.author.get(path);
    return { res, why: ok(res) ? '' : describe(res) };
  } catch (e) {
    return { res: null, why: e instanceof LockedError ? e.message : (e as Error).message };
  }
}

/** Führt einen Check aus; jede unerwartete Ausnahme wird zu "unbekannt". */
async function guard(ids: string[], at: number, fn: () => Promise<CheckResult[]>): Promise<CheckResult[]> {
  const scope = { retried: false };
  let results: CheckResult[];
  try {
    results = await retryScope.run(scope, fn);
  } catch (e) {
    results = ids.map((id) => ({ id, value: null, detail: (e as Error).message, at }));
  }
  return scope.retried ? results.map((r) => ({ ...r, retried: true })) : results;
}

const unknown = (ids: string[], at: number, detail: string): CheckResult[] => ids.map((id) => ({ id, value: null, detail, at }));

const FAST_IDS = ['author_up', 'login', 'resp_author', 'publish_agent', 'repl_blocked', 'repl_queue', 'repl_oldest', 'publish_up', 'resp_publish'];
const SLOW_IDS = ['error_page', 'samples_author', 'samples_publish', 'bundles_inactive', 'heap', 'disk', 'jobs_queued'];
const NET_DOWN = 'Netzwerk/VPN getrennt, nicht geprüft.';

/** Schnelle Checks: Erreichbarkeit, Anmeldung, Replication, Antwortzeiten. */
export async function runFast(ctx: Ctx): Promise<CheckResult[]> {
  const now = ctx.now ?? Date.now;
  const at = now();
  // Nur DNS + TCP zum Author-Host, keine HTTP-Anfrage und keine Anmeldung.
  const net = await guard(['vpn'], at, async () => {
    const r = await (ctx.reach ?? tcpReach)(ctx.author.baseUrl);
    return [{ id: 'vpn', value: r.ok ? 1 : 0, detail: r.ok ? undefined : `Author-Host nicht erreichbar: ${r.error}`, at }];
  });
  ctx.netDown = net[0]?.value === 0;
  if (ctx.netDown) return [...net, ...unknown(FAST_IDS, at, NET_DOWN)];
  const parts = await Promise.all([
    Promise.resolve(net),
    guard(['author_up'], at, async () => {
      const r = await ctx.author.getAnonymous('/libs/granite/core/content/login.html');
      return [{ id: 'author_up', value: ok(r) ? 1 : 0, detail: ok(r) ? undefined : describe(r), at }];
    }),
    guard(['login', 'resp_author', 'publish_agent', 'repl_blocked', 'repl_queue', 'repl_oldest'], at, async () => {
      const ids = ['login', 'resp_author', 'publish_agent', 'repl_blocked', 'repl_queue', 'repl_oldest'];
      const list = await authorGet(ctx, '/etc/replication/agents.author.2.json');
      if (!list.res) {
        const locked = ctx.author.locked !== null;
        return [
          { id: 'login', value: locked ? 0 : null, detail: list.why, at },
          ...unknown(ids.slice(1), at, list.why),
        ];
      }
      const login: CheckResult = { id: 'login', value: list.res.status === 401 || list.res.status === 403 ? 0 : ok(list.res) ? 1 : null, detail: list.why || undefined, at };
      const resp: CheckResult = { id: 'resp_author', value: ok(list.res) ? list.res.ms : null, detail: list.why || undefined, at };
      const agents = ok(list.res) ? enabledAgents(list.res.body) : null;
      if (!agents) return [login, resp, ...unknown(ids.slice(2), at, list.why || 'Agent-Liste unlesbar')];

      let blocked = 0;
      let entries = 0;
      let oldestMin = 0;
      let publishBad = 0;
      let unreadable = '';
      const notes: string[] = [];
      for (const a of agents) {
        const q = await authorGet(ctx, `/etc/replication/agents.author/${a.id}/jcr:content.queue.json`);
        const info = q.res && ok(q.res) ? parseQueue(q.res.body) : null;
        if (!info) {
          unreadable = `${a.id}: ${q.why || 'Queue unlesbar'}`;
          if (a.isPublish) publishBad++;
          continue;
        }
        entries += info.length;
        if (info.oldest !== null) oldestMin = Math.max(oldestMin, (now() - info.oldest) / 60000);
        if (info.blocked || info.paused) {
          blocked++;
          if (a.isPublish) publishBad++;
          notes.push(`${a.id}: ${info.blocked ? 'blockiert' : 'pausiert'}, ${info.length}${info.length >= 50 ? '+' : ''} Einträge`);
        }
      }
      const hasPublish = agents.some((a) => a.isPublish);
      const detail = (notes.join('; ') || unreadable) || undefined;
      const queueUnknown = unreadable !== '' && notes.length === 0;
      return [
        login,
        resp,
        { id: 'publish_agent', value: hasPublish && publishBad === 0 ? 1 : 0, detail: hasPublish ? detail : 'Kein aktiver Publish-Agent', at },
        { id: 'repl_blocked', value: queueUnknown ? null : blocked, detail, at },
        { id: 'repl_queue', value: queueUnknown ? null : entries, detail: queueUnknown ? detail : entries >= 50 ? 'mindestens (AEM listet höchstens 50)' : undefined, at },
        { id: 'repl_oldest', value: queueUnknown ? null : Math.round(oldestMin), detail, at },
      ];
    }),
    guard(['publish_up', 'resp_publish'], at, async () => {
      const r = await ctx.publish.getAnonymous(PUBLISH_PAGE);
      const up = ok(r) && r.body.includes('fhg-header');
      return [
        { id: 'publish_up', value: up ? 1 : 0, detail: up ? undefined : ok(r) ? 'Seite ohne Fraunhofer-Header' : describe(r), at },
        { id: 'resp_publish', value: r.status === 0 ? null : r.ms, detail: r.error, at },
      ];
    }),
  ]);
  return parts.flat();
}

/** Langsame Checks: Bundles, Heap, Disk, Jobs, Fehlerseite, Samples. */
export async function runSlow(ctx: Ctx): Promise<CheckResult[]> {
  const at = (ctx.now ?? Date.now)();
  if (ctx.netDown) return unknown(SLOW_IDS, at, NET_DOWN);
  const parts = await Promise.all([
    guard(['error_page'], at, async () => {
      const r = await ctx.publish.getAnonymous(MISSING_PAGE);
      const good = r.status === 404 && r.body.includes('Fehlerseite 404');
      return [{ id: 'error_page', value: r.status === 0 ? null : good ? 1 : 0, detail: good ? undefined : r.error ?? `HTTP ${r.status}, keine Fraunhofer-Fehlerseite`, at }];
    }),
    guard(['samples_author'], at, async () => {
      const missing: string[] = [];
      for (const p of ['/content/samples/de.json', '/content/dam/samples.json']) {
        const a = await authorGet(ctx, p);
        if (!a.res) return unknown(['samples_author'], at, a.why);
        if (!ok(a.res)) missing.push(`${p}: ${a.why}`);
      }
      return [{ id: 'samples_author', value: missing.length ? 0 : 1, detail: missing.join('; ') || undefined, at }];
    }),
    guard(['samples_publish'], at, async () => {
      const pub = await ctx.publish.getAnonymous('/content/samples/de.html');
      if (pub.status === 0) return unknown(['samples_publish'], at, describe(pub));
      return [{ id: 'samples_publish', value: ok(pub) ? 1 : 0, detail: ok(pub) ? undefined : `/content/samples/de.html: ${describe(pub)}`, at }];
    }),
    guard(['bundles_inactive'], at, async () => {
      const b = await authorGet(ctx, '/system/console/bundles.json');
      const n = b.res && ok(b.res) ? inactiveBundles(b.res.body) : null;
      if (b.res && ok(b.res)) ctx.onInfo?.({ oak: oakVersion(b.res.body) });
      return [{ id: 'bundles_inactive', value: n, detail: n === null ? b.why || 'unlesbar' : undefined, at }];
    }),
    guard(['heap'], at, async () => {
      const m = await authorGet(ctx, '/system/console/jmx/java.lang%3Atype%3DMemory');
      const v = m.res && ok(m.res) ? heapPercent(m.res.body) : null;
      return [{ id: 'heap', value: v === null ? null : Math.round(v * 10) / 10, detail: v === null ? m.why || 'unlesbar' : undefined, at }];
    }),
    guard(['disk'], at, async () => {
      const u = await authorGet(ctx, DISK_USABLE);
      const t = await authorGet(ctx, DISK_TOTAL);
      const v = u.res && t.res && ok(u.res) && ok(t.res) ? diskPercentUsed(jmxValue(u.res.body), jmxValue(t.res.body)) : null;
      return [{ id: 'disk', value: v === null ? null : Math.round(v * 10) / 10, detail: v === null ? u.why || t.why || 'unlesbar' : undefined, at }];
    }),
    guard(['jobs_queued'], at, async () => {
      const j = await authorGet(ctx, '/system/console/slingevent.json');
      const n = j.res && ok(j.res) ? numberAfter(htmlToCells(j.res.body), 'Queued Jobs') : null;
      return [{ id: 'jobs_queued', value: n, detail: n === null ? j.why || 'unlesbar' : undefined, at }];
    }),
  ]);
  return parts.flat();
}

/** AEM- und Java-Version der Author-Instanz (Anzeige, kein Kriterium). Nicht lesbar = null. Zwei Anfragen, nacheinander. */
export async function fetchVersions(ctx: Ctx): Promise<Pick<Versions, 'aem' | 'java'>> {
  if (ctx.netDown) return { aem: null, java: null };
  const p = await authorGet(ctx, '/system/console/status-productinfo.json');
  const r = await authorGet(ctx, '/system/console/jmx/java.lang%3Atype%3DRuntime');
  return { aem: p.res && ok(p.res) ? aemVersion(p.res.body) : null, java: r.res && ok(r.res) ? javaVersion(r.res.body) : null };
}
