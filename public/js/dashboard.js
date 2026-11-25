import { STATUS_ICON, groupChecks, overallText, overallWord, relTime, scoreText, staleness, unknownHint } from './logic.js';
import { createTile } from './tile.js';
import { createGauge } from './instruments.js';
import { SCORE_ZONES } from './geometry.js';

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

/**
 * Zeichnet das Dashboard. Beim ersten Zustand entsteht das Gerüst, danach werden nur
 * Werte aktualisiert (Elemente bleiben stehen, damit Animationen weiterlaufen).
 */
export function createDashboard(root, { onUnlock, onOpen, onMaintenance }) {
  /** envId → { section, tiles: Map, parts } */
  const envs = new Map();

  function build(env, groups) {
    const section = el('section', 'env');
    section.setAttribute('aria-labelledby', `env-${env.id}`);
    section.dataset.env = env.id;

    const head = el('header', 'env-head');
    const title = el('h2', '', env.label);
    title.id = `env-${env.id}`;
    const main = createGauge({ min: 0, max: 100, zones: SCORE_ZONES, format: (v) => (v === null ? '–' : String(v)), big: true });
    const overall = el('div', 'env-overall');
    overall.setAttribute('role', 'status');
    const hint = el('p', 'env-hint');
    const meta = el('p', 'env-meta');
    const titles = el('div', 'env-titles');
    titles.append(title, overall, hint, meta);
    const maintBtn = el('button', 'btn env-maint', 'Wartung');
    maintBtn.type = 'button';
    maintBtn.addEventListener('click', () => onMaintenance(env.id, maintBtn.getAttribute('aria-pressed') !== 'true'));
    head.append(main.el, titles, maintBtn);

    const banner = el('div', 'banner');
    banner.hidden = true;
    const bannerText = el('span');
    const unlock = el('button', 'btn', 'Erneut versuchen');
    unlock.type = 'button';
    unlock.addEventListener('click', () => onUnlock(env.id));
    banner.append(bannerText, unlock);

    const body = el('div', 'env-body');
    const tiles = new Map();
    for (const g of groupChecks(env.checks, groups)) {
      const group = el('section', 'group');
      const gh = el('h3', 'group-title', g.label);
      const grid = el('div', 'tiles');
      for (const c of g.checks) {
        const t = createTile(c.def, (opener) => onOpen(env.id, env.label, c.def, opener));
        tiles.set(c.def.id, t);
        grid.append(t.el);
      }
      group.append(gh, grid);
      body.append(group);
    }
    section.append(head, banner, body);
    root.append(section);
    return { section, tiles, main, overall, hint, maintBtn, meta, banner, bannerText, unlock };
  }

  return {
    render(state, now = Date.now()) {
      for (const env of state.envs) {
        const view = envs.get(env.id) ?? (envs.set(env.id, build(env, state.groups)), envs.get(env.id));
        const maint = env.maintenance != null;
        view.section.dataset.status = env.overall.status;
        view.maintBtn.setAttribute('aria-pressed', String(maint));
        view.maintBtn.textContent = maint ? 'Wartung beenden' : 'Wartung';
        view.maintBtn.title = maint ? 'Prüfungen wieder aufnehmen' : 'In Wartung setzen: keine Prüfungen und keine Anfragen';
        view.overall.textContent = maint ? '⚙ In Wartung' : `${STATUS_ICON[env.overall.status]} ${overallWord(env.overall)} · ${scoreText(env.overall)}`;
        view.hint.textContent = maint ? '' : unknownHint(env.overall.counts);
        view.hint.hidden = !view.hint.textContent;
        view.overall.setAttribute('aria-label', maint ? `${env.label}: In Wartung` : overallText(env));
        view.main.update(env.overall.score, env.overall.status);
        const st = staleness(env, state.intervals, now);
        view.meta.textContent = maint ? 'Keine Prüfungen, solange die Umgebung in Wartung ist.' : `Schnell ${relTime(env.updatedAt.fast, now)} · Langsam ${relTime(env.updatedAt.slow, now)} · Anfragen/min: Author ${env.requestsPerMinute.author}, Publish ${env.requestsPerMinute.publish}`;
        for (const c of env.checks) view.tiles.get(c.def.id)?.update(c);

        // Sperre hat Vorrang vor "veraltet": ohne Zugang gibt es keine frischen Daten, aber aus gutem Grund.
        view.banner.hidden = !maint && !env.locked && !st.any;
        view.banner.dataset.kind = maint ? 'maintenance' : env.locked ? 'locked' : 'stale';
        view.bannerText.textContent = maint
          ? `Wartung${env.maintenance ? `: ${env.maintenance}` : ''}. Die Umgebung ist vorübergehend nicht verfügbar, das Dashboard sendet keine Anfragen.`
          : env.locked
            ? `Zugang gesperrt: ${env.locked}. Das Dashboard sendet keine weiteren Anmeldungen, bis Sie es erlauben.`
            : 'Daten veraltet: Der letzte Lauf liegt zu lange zurück.';
        view.unlock.hidden = maint || !env.locked;
      }
    },
  };
}
