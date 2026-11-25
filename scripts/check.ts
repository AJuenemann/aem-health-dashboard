/**
 * Führt die Checks aus und druckt den Zustand.
 * Aufruf: npm run check -- --env dev [--watch]
 * Ohne --watch: ein Durchlauf (schnell + langsam). Mit --watch: im Takt aus config/checks.json.
 */
import { Monitor, type EnvState } from '../src/monitor.ts';
import { loadCredentials, loadEnvironments } from '../src/config.ts';
import { loadChecks } from '../src/evaluate.ts';
import { renderTable } from '../src/probe-lib.ts';

const argv = process.argv.slice(2);
const i = argv.indexOf('--env');
const envId = i >= 0 ? argv[i + 1] : undefined;
const envs = loadEnvironments().filter((e) => !envId || e.id === envId);
if (envs.length === 0) throw new Error(`Unbekannte Umgebung "${envId}". Aufruf: npm run check -- --env dev|test [--watch]`);

const monitor = new Monitor(envs, loadChecks(), loadCredentials());

function print(s: EnvState): void {
  const rows = [['Check', 'Status', 'Wert', 'Hinweis']];
  for (const c of s.checks) {
    const v = c.value === null ? '-' : `${c.value}${c.def.unit ? ` ${c.def.unit}` : ''}`;
    rows.push([c.def.label, c.status, v, c.detail ?? '']);
  }
  const o = s.overall;
  console.log(`\n${new Date().toLocaleTimeString('de-DE')}  ${s.label}: ${o.status.toUpperCase()}  Score ${o.score}${s.locked ? `  ZUGANG GESPERRT: ${s.locked}` : ''}`);
  console.log(renderTable(rows));
  console.log(`Requests/min: Author ${s.requestsPerMinute.author}, Publish ${s.requestsPerMinute.publish}`);
}

if (argv.includes('--watch')) {
  monitor.on('update', (id: string) => {
    const s = monitor.state().find((x) => x.id === id);
    if (s) print(s);
  });
  monitor.start();
  console.log('Watch läuft (Strg+C beendet). Erste Ergebnisse folgen in wenigen Sekunden.');
} else {
  await monitor.runOnce();
  monitor.state().forEach(print);
}
