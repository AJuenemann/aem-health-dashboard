import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createApp } from './api.ts';
import { ROOT, loadCredentials, loadEnvironments } from './config.ts';
import { loadChecks } from './evaluate.ts';
import { History } from './history.ts';
import { Monitor } from './monitor.ts';

const credentials = loadCredentials();
const checks = loadChecks();
const monitor = new Monitor(loadEnvironments(), checks, credentials);
const history = new History(resolve(ROOT, process.env.DATA_DIR ?? 'data', 'history'));

// Wartungsmodus aus der Oberfläche bleibt über Neustarts erhalten (id → Grund, "" = ohne Angabe). Gilt vor der Konfiguration.
const maintenanceFile = resolve(ROOT, process.env.DATA_DIR ?? 'data', 'maintenance.json');
const saved: Record<string, string | null> = existsSync(maintenanceFile) ? JSON.parse(readFileSync(maintenanceFile, 'utf8')) : {};
for (const [id, reason] of Object.entries(saved)) monitor.setMaintenance(id, reason !== null, reason ?? '');
monitor.on('maintenance', (id: string, reason: string | null) => {
  saved[id] = reason;
  try {
    writeFileSync(maintenanceFile, JSON.stringify(saved));
  } catch (e) {
    console.error('Wartungsstatus nicht schreibbar:', (e as Error).message);
  }
});

history.prune();
setInterval(() => history.prune(), 6 * 3_600_000).unref();
monitor.on('update', (env: string, tempo: 'fast' | 'slow', results) => {
  try {
    history.append(env, tempo, results);
  } catch (e) {
    console.error('Verlauf nicht schreibbar:', (e as Error).message);
  }
});

function shutdown(): void {
  monitor.stop();
  app.close(() => process.exit(0));
  app.closeAllConnections(); // offene Event-Streams würden das Schließen sonst blockieren
  setTimeout(() => process.exit(0), 1000).unref();
}

const app = createApp({ monitor, history, publicDir: resolve(ROOT, 'public'), intervals: checks.intervals, groups: checks.groups, onShutdown: shutdown });
const port = Number(process.env.PORT ?? 4400);
// Lokal nur 127.0.0.1. Im Container setzt die Compose-Datei HOST=0.0.0.0 (Port wird nur an localhost veröffentlicht).
const host = process.env.HOST ?? '127.0.0.1';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Port belegt: Ist es eine frühere Dashboard-Session, beenden wir sie. Fremde Dienste bleiben unangetastet. */
async function stopPreviousSession(): Promise<void> {
  const base = `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}`;
  try {
    const health = (await (await fetch(`${base}/healthz`, { signal: AbortSignal.timeout(2000) })).json()) as { app?: string };
    if (health.app !== 'aem-health-dashboard') throw new Error('kein Dashboard');
    await fetch(`${base}/api/shutdown`, { method: 'POST', headers: { 'X-Requested-With': 'dashboard' }, signal: AbortSignal.timeout(2000) });
  } catch {
    console.error(`Port ${port} ist von einem anderen Dienst belegt (kein AEM Health Dashboard). Anderen PORT in .env setzen.`);
    process.exit(1);
  }
  console.log(`Frühere Dashboard-Session auf Port ${port} beendet.`);
}

/** Ein Bindeversuch: true = lauscht, sonst der Fehlercode. */
const tryListen = () =>
  new Promise<true | string>((r) => {
    app.once('error', (e: NodeJS.ErrnoException) => r(e.code ?? e.message));
    app.listen(port, host, () => r(true));
  });

let result = await tryListen();
if (result === 'EADDRINUSE') {
  await stopPreviousSession();
  for (let i = 0; i < 20 && result !== true; i++) {
    await sleep(250); // alter Prozess braucht einen Moment, bis der Port frei ist
    result = await tryListen();
  }
}
if (result !== true) {
  console.error(`Start fehlgeschlagen: ${result}`);
  process.exit(1);
}

const url = `http://${host === '0.0.0.0' ? 'localhost' : host}:${port}/`;
console.log(`AEM Health Dashboard: ${url}`);
monitor.start();
// Nur bei "npm start": Container (node direkt) und Tests öffnen keinen Tab.
if (process.env.npm_lifecycle_event === 'start') {
  const [cmd, ...args] =
    process.platform === 'darwin' ? ['open'] : process.platform === 'win32' ? ['cmd', '/c', 'start', '""'] : ['xdg-open'];
  spawn(cmd, [...args, url], { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
}

for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, shutdown);
