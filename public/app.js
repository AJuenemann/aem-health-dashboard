import { createDashboard } from './js/dashboard.js';
import { openHistory } from './js/history-view.js';
import { netBannerText, netDownEnvs } from './js/logic.js';

const root = document.getElementById('envs');
const conn = document.getElementById('conn');
const netBanner = document.getElementById('net-banner');
const themeBtn = document.getElementById('theme');

// --- Theme (hell/dunkel über data-theme am <html>) ---
const ICON_ATTR = 'viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
const ICON_SUN = `<svg ${ICON_ATTR}><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/></svg>`;
const ICON_MOON = `<svg ${ICON_ATTR}><path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.8 6.8 0 0 0 10.5 10.5z"/></svg>`;
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  themeBtn.setAttribute('aria-pressed', String(theme === 'dark'));
  themeBtn.innerHTML = theme === 'dark' ? ICON_SUN : ICON_MOON; // zeigt das Ziel: im Dunkelmodus die Sonne
}
applyTheme(document.documentElement.dataset.theme);
themeBtn.addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  try { localStorage.setItem('aem-health-theme', next); } catch { /* privater Modus */ }
});

// --- Zustand ---
const dashboard = createDashboard(root, {
  onOpen: openHistory,
  onMaintenance: async (env, on) => {
    let reason = '';
    if (on) {
      reason = prompt('In Wartung setzen. Es werden keine Anfragen gesendet.\nGrund (optional):', '');
      if (reason === null) return;
    }
    await fetch(`/api/maintenance?env=${encodeURIComponent(env)}&on=${on ? 1 : 0}&reason=${encodeURIComponent(reason)}`, { method: 'POST', headers: { 'X-Requested-With': 'dashboard' } });
    refresh();
  },
  onUnlock: (env) => fetch(`/api/unlock?env=${encodeURIComponent(env)}`, { method: 'POST', headers: { 'X-Requested-With': 'dashboard' } }),
});
let state = null;
// --- Ansicht: eine Umgebung oder alle (Auswahl bleibt im Browser gespeichert) ---
const viewBox = document.getElementById('view');
let view = 'all';
try { view = localStorage.getItem('aem-health-view') ?? 'all'; } catch { /* privater Modus */ }

function applyView() {
  root.dataset.view = view;
  for (const b of viewBox.children) b.setAttribute('aria-pressed', String(b.dataset.view === view));
  for (const s of root.children) s.hidden = view !== 'all' && s.dataset.env !== view;
  const label = view === 'all' ? 'alle Umgebungen' : (state?.envs.find((e) => e.id === view)?.label ?? view);
  document.getElementById('refresh').title = `Prüfungen jetzt ausführen: ${label}`;
  resetRefreshButton();
}
function buildViewButtons(envs) {
  const opts = [...envs.map((e) => [e.id, e.label]), ['all', 'Alle Umgebungen']];
  if (!opts.some(([id]) => id === view)) view = 'all';
  for (const [id, label] of opts) {
    const b = Object.assign(document.createElement('button'), { type: 'button', className: 'btn', textContent: label });
    b.dataset.view = id;
    b.addEventListener('click', () => {
      view = id;
      try { localStorage.setItem('aem-health-view', id); } catch { /* privater Modus */ }
      applyView();
    });
    viewBox.append(b);
  }
}

const render = () => {
  if (!state) return;
  if (!viewBox.children.length) buildViewButtons(state.envs);
  dashboard.render(state);
  applyView();
  // Allgemeiner Hinweis bei getrennter Verbindung, nur für die angezeigte Ansicht. Text nur bei Änderung setzen (Screenreader).
  const shown = view === 'all' ? state.envs : state.envs.filter((e) => e.id === view);
  const text = netBannerText(netDownEnvs(shown));
  if (netBanner.textContent !== text) netBanner.textContent = text;
  netBanner.hidden = !text;
};

function setConn(kind, text) {
  conn.dataset.state = kind;
  conn.textContent = text;
}

// Live-Verbindung. Nach Ruhezustand/Standby ist die alte Verbindung oft tot, ohne dass der Browser es merkt.
// Darum: beim Aufwachen sofort Zustand holen und neu verbinden, dazu eine Wache für ausbleibende Ereignisse.
let stream = null;
let lastEvent = Date.now();
let ended = false;
const STALL_MS = 90_000; // Der Server sendet mindestens alle 30 s ein Ereignis je Umgebung.

function connect() {
  if (ended) return;
  stream?.close();
  stream = new EventSource('/api/stream');
  stream.addEventListener('state', (e) => {
    lastEvent = Date.now();
    state = JSON.parse(e.data);
    setConn('ok', 'Verbunden');
    render();
  });
  stream.onerror = () => setConn('down', 'Verbindung unterbrochen, versuche erneut …');
}

async function refresh() {
  if (ended) return;
  try {
    const r = await fetch('/api/state', { cache: 'no-store' });
    if (!r.ok) throw new Error(String(r.status));
    state = await r.json();
    lastEvent = Date.now();
    setConn('ok', 'Verbunden');
    render();
  } catch {
    setConn('down', 'Verbindung unterbrochen, versuche erneut …');
  }
}

function wake() {
  if (document.visibilityState === 'hidden') return;
  connect();
  void refresh();
}
document.addEventListener('visibilitychange', wake);
window.addEventListener('focus', wake);
window.addEventListener('online', wake);
window.addEventListener('pageshow', wake);
setInterval(() => {
  if (!ended && document.visibilityState === 'visible' && Date.now() - lastEvent > STALL_MS) wake();
}, 15_000);
connect();

// --- Alle Prüfungen sofort auslösen ---
const refreshBtn = document.getElementById('refresh');
const refreshLabel = document.getElementById('refresh-label');
const IDLE_LABEL = 'Jetzt prüfen';
let cooldownTimer = 0;
let cooldownView = null;

// Ansicht gewechselt: die Pause gilt nur für die zuvor geprüfte Ansicht, der Server entscheidet bei neuem Klick.
function resetRefreshButton() {
  if (!refreshBtn.disabled || refreshBtn.hasAttribute('aria-busy') || cooldownView === view) return;
  clearInterval(cooldownTimer);
  refreshBtn.disabled = false;
  delete refreshBtn.dataset.done;
  refreshLabel.textContent = IDLE_LABEL;
}

// Sperrt den Button bis zum Ablauf der Pause und zählt sichtbar herunter. Der Server erzwingt die Pause ohnehin.
function startCooldown(ms, prefix) {
  clearInterval(cooldownTimer);
  cooldownView = view;
  const until = Date.now() + ms;
  refreshBtn.disabled = true;
  const tick = () => {
    const left = Math.ceil((until - Date.now()) / 1000);
    if (left <= 0) {
      clearInterval(cooldownTimer);
      refreshBtn.disabled = false;
      delete refreshBtn.dataset.done;
      refreshLabel.textContent = IDLE_LABEL;
      return;
    }
    refreshLabel.textContent = `${prefix} · wieder in ${left} s`;
  };
  tick();
  cooldownTimer = setInterval(tick, 1000);
}

refreshBtn.addEventListener('click', async () => {
  if (refreshBtn.disabled) return;
  clearInterval(cooldownTimer);
  delete refreshBtn.dataset.done;
  refreshBtn.disabled = true;
  refreshBtn.setAttribute('aria-busy', 'true');
  refreshLabel.textContent = 'Prüfe …'; // Text zusätzlich zur Drehung (reduzierte Bewegung)
  try {
    const scope = view === 'all' ? '' : `?env=${encodeURIComponent(view)}`;
    const r = await fetch(`/api/refresh${scope}`, { method: 'POST', headers: { 'X-Requested-With': 'dashboard' } });
    const body = await r.json().catch(() => ({}));
    refreshBtn.removeAttribute('aria-busy');
    if (r.ok) {
      refreshBtn.dataset.done = 'true';
      startCooldown(body.nextInMs ?? 15_000, `✓ Fertig ${new Date().toLocaleTimeString('de-DE')}`);
    } else if (r.status === 429) {
      startCooldown(body.nextInMs ?? 15_000, 'Gerade erst geprüft');
    } else {
      throw new Error(String(r.status));
    }
  } catch (e) {
    refreshBtn.removeAttribute('aria-busy');
    refreshBtn.disabled = false;
    refreshLabel.textContent = IDLE_LABEL;
    alert(`Aktualisieren fehlgeschlagen: ${e.message}`);
  }
});

// --- Beenden: Dienst stoppt und gibt den Port frei ---
document.getElementById('power').addEventListener('click', async () => {
  if (!confirm('Dashboard beenden? Der Dienst stoppt und gibt den Port frei.')) return;
  try {
    const r = await fetch('/api/shutdown', { method: 'POST', headers: { 'X-Requested-With': 'dashboard' } });
    if (!r.ok) throw new Error(String(r.status));
  } catch (e) {
    alert(`Beenden fehlgeschlagen: ${e.message}`);
    return;
  }
  ended = true;
  stream.close();
  state = null;
  setConn('down', 'Beendet');
  root.replaceChildren(Object.assign(document.createElement('p'), { className: 'history-wait', textContent: 'Dashboard beendet. Dieses Fenster kann geschlossen werden.' }));
});

// Relative Zeiten und "veraltet" auch ohne neue Daten aktuell halten.
setInterval(render, 5000);
