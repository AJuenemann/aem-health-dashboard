/** Reine Hilfen des Probe-Skripts (ohne Netzwerk, unit-getestet). */

export interface ProbeTarget {
  name: string;
  host: 'author' | 'publish';
  auth: boolean;
  path: string;
}

/** Kandidaten-Endpunkte. Nur GET. Was davon trägt, steht danach in docs/ENDPOINTS.md. */
export const TARGETS: ProbeTarget[] = [
  { name: 'author-login-seite', host: 'author', auth: false, path: '/libs/granite/core/content/login.html' },
  { name: 'agents-liste', host: 'author', auth: true, path: '/etc/replication/agents.author.2.json' },
  { name: 'bundles', host: 'author', auth: true, path: '/system/console/bundles.json' },
  { name: 'health-json', host: 'author', auth: true, path: '/system/health.json' },
  { name: 'health-format', host: 'author', auth: true, path: '/system/health?format=json' },
  { name: 'jmx-memory', host: 'author', auth: true, path: '/system/console/jmx/java.lang%3Atype%3DMemory' },
  { name: 'jmx-os', host: 'author', auth: true, path: '/system/console/jmx/java.lang%3Atype%3DOperatingSystem' },
  { name: 'sling-mbean-memory', host: 'author', auth: true, path: '/system/sling/monitoring/mbeans/java.lang/type/Memory.tidy.json' },
  { name: 'sling-mbean-memory-b', host: 'author', auth: true, path: '/system/sling/monitoring/mbeans/java/lang/type/Memory.tidy.json' },
  { name: 'jmx-disk-usable', host: 'author', auth: true, path: '/system/console/jmx/com.adobe.granite%3Aname%3DDISK_USABLE_SPACE%2Ctype%3DMetrics' },
  { name: 'jmx-disk-total', host: 'author', auth: true, path: '/system/console/jmx/com.adobe.granite%3Aname%3DDISK_TOTAL_SPACE%2Ctype%3DMetrics' },
  { name: 'hc-console-json', host: 'author', auth: true, path: '/system/console/healthcheck?format=json' },
  { name: 'hc-systemalive', host: 'author', auth: true, path: '/system/console/healthcheck?tags=systemalive' },
  { name: 'slingjobs', host: 'author', auth: true, path: '/system/console/slingevent.json' },
  { name: 'jmx-runtime', host: 'author', auth: true, path: '/system/console/jmx/java.lang%3Atype%3DRuntime' },
  { name: 'status-produkt', host: 'author', auth: true, path: '/system/console/status-productinfo.json' },
  { name: 'workflow-instanzen', host: 'author', auth: true, path: '/etc/workflow/instances.json' },
  { name: 'samples-seiten', host: 'author', auth: true, path: '/content/samples/de.json' },
  { name: 'samples-dam', host: 'author', auth: true, path: '/content/dam/samples.json' },
  { name: 'publish-startseite', host: 'publish', auth: false, path: '/content/zv/de.html' },
  { name: 'publish-fehlerseite', host: 'publish', auth: false, path: '/content/zv/de/qa-seite-gibt-es-nicht.html' },
  { name: 'publish-samples', host: 'publish', auth: false, path: '/content/samples/de.html' },
];

/** Kurzbeschreibung eines Antwortkörpers: JSON-Struktur oder Titel/Anfang bei HTML. */
export function summarize(body: string): string {
  const t = body.trim();
  if (!t) return '(leer)';
  if (t.startsWith('{') || t.startsWith('[')) {
    try {
      const j: unknown = JSON.parse(t);
      if (Array.isArray(j)) return `Array[${j.length}]`;
      const keys = Object.keys(j as object);
      return `{${keys.slice(0, 6).join(',')}${keys.length > 6 ? ',…' : ''}} (${keys.length} Schlüssel)`;
    } catch {
      return 'ungültiges JSON';
    }
  }
  const title = /<title[^>]*>([^<]*)<\/title>/i.exec(t)?.[1]?.trim();
  if (title) return `HTML „${title.slice(0, 50)}“`;
  return t.replace(/\s+/g, ' ').slice(0, 60);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Liest `--env <id>` und `--save` aus argv. */
export function parseProbeArgs(argv: string[]): { env: string; save: boolean } {
  const i = argv.indexOf('--env');
  const env = i >= 0 ? (argv[i + 1] ?? '') : '';
  if (!env || env.startsWith('--')) throw new Error('Aufruf: npm run probe -- --env dev|test [--save]');
  return { env, save: argv.includes('--save') };
}

/** Markdown-/Konsolentabelle aus Zeilen. */
export function renderTable(rows: string[][]): string {
  const widths = rows[0]!.map((_, c) => Math.max(...rows.map((r) => (r[c] ?? '').length)));
  return rows.map((r) => r.map((cell, c) => cell.padEnd(widths[c] ?? 0)).join('  ')).join('\n');
}
