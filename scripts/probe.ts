/**
 * Probe: rein lesende GETs auf Kandidaten-Endpunkte einer Umgebung (sequenziell, lastschonend).
 * Aufruf: npm run probe -- --env dev [--save]
 * --save legt die Rohantworten (JSON) unter data/probe/<env>/ ab (gitignoriert).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { AemClient, LockedError } from '../src/aem-client.ts';
import { ROOT, loadCredentials, loadEnvironments } from '../src/config.ts';
import { TARGETS, formatBytes, parseProbeArgs, renderTable, summarize } from '../src/probe-lib.ts';

const { env, save } = parseProbeArgs(process.argv.slice(2));
const cfg = loadEnvironments().find((e) => e.id === env);
if (!cfg) throw new Error(`Unbekannte Umgebung "${env}".`);

const author = new AemClient({ baseUrl: cfg.baseUrl, credentials: loadCredentials() });
const publish = new AemClient({ baseUrl: cfg.publishUrl });
const dir = `${ROOT}data/probe/${env}`;
if (save) mkdirSync(dir, { recursive: true });

const rows: string[][] = [['Name', 'Host', 'HTTP', 'Dauer', 'Größe', 'Inhalt']];
for (const t of TARGETS) {
  const client = t.host === 'author' ? author : publish;
  try {
    const r = t.auth ? await author.get(t.path) : await client.getAnonymous(t.path);
    rows.push([t.name, t.host, String(r.status || 'ERR'), `${r.ms} ms`, formatBytes(r.bytes), r.error ?? summarize(r.body)]);
    if (save && r.status === 200) writeFileSync(`${dir}/${t.name}.txt`, r.body);
  } catch (e) {
    rows.push([t.name, t.host, 'GESPERRT', '-', '-', e instanceof LockedError ? e.reason : (e as Error).message]);
    if (e instanceof LockedError) break; // Breaker: keine weiteren Versuche
  }
}
// Queue je aktivem Agent (Id kommt aus der Agent-Liste).
if (!author.locked) {
  const list = await author.get('/etc/replication/agents.author.2.json');
  if (list.status === 200) {
    const agents = JSON.parse(list.body) as Record<string, { 'jcr:content'?: { enabled?: unknown; transportUri?: string } }>;
    for (const [id, a] of Object.entries(agents)) {
      if (String(a?.['jcr:content']?.enabled) !== 'true') continue;
      const r = await author.get(`/etc/replication/agents.author/${id}/jcr:content.queue.json`);
      rows.push([`queue:${id}`, 'author', String(r.status), `${r.ms} ms`, formatBytes(r.bytes), r.body.slice(0, 160).replace(/\s+/g, ' ')]);
      if (save && r.status === 200) writeFileSync(`${dir}/queue-${id}.txt`, r.body);
    }
  }
}
console.log(`\nProbe ${cfg.label} (${cfg.baseUrl})\n`);
console.log(renderTable(rows));
console.log(`\nRequests/min: Author ${author.requestsPerMinute()}, Publish ${publish.requestsPerMinute()}`);
