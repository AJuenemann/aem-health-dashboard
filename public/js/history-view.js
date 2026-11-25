import { formatValue } from './logic.js';
import { zonesFor } from './geometry.js';
import { axisMax, buildSegments, segmentPath, summary, timeTicks, yOf } from './plot.js';

const SVG = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}, cls) => {
  const n = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  if (cls) n.setAttribute('class', cls);
  return n;
};
const html = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

const W = 640;
const H = 260;
const M = { left: 56, right: 14, top: 14, bottom: 30 };
const RANGES = [
  { hours: 24, label: '24 Stunden' },
  { hours: 168, label: '7 Tage' },
];

let dialog = null;
let ui = null;

/** Dialog einmalig aufbauen. */
function ensureDialog() {
  if (dialog) return;
  dialog = html('dialog', 'history');
  dialog.setAttribute('aria-labelledby', 'history-title');
  const head = html('div', 'history-head');
  const title = html('h2', '', '');
  title.id = 'history-title';
  const close = html('button', 'btn', 'Schließen');
  close.type = 'button';
  close.addEventListener('click', () => dialog.close());
  head.append(title, close);
  const ranges = html('div', 'history-ranges');
  ranges.setAttribute('role', 'group');
  ranges.setAttribute('aria-label', 'Zeitraum');
  const chart = html('div', 'history-chart');
  const facts = html('p', 'history-facts');
  facts.setAttribute('aria-live', 'polite');
  dialog.append(head, ranges, chart, facts);
  // Klick auf den abgedunkelten Hintergrund schließt.
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
  dialog.addEventListener('close', () => ui.opener?.focus());
  document.body.append(dialog);
  ui = { title, ranges, chart, facts, opener: null };
}

/** Skala des Verlaufs: Lampen 0/1, sonst Skala der Konfiguration (bei größeren Messwerten erweitert). */
function scaleFor(def, points) {
  if (def.element === 'lamp') return { min: -0.15, max: 1.15 };
  const dataMax = Math.max(0, ...points.map((p) => p[1] ?? 0));
  return { min: def.scale.min, max: axisMax(def.scale.max, dataMax) };
}

function drawChart(def, data, hours, now) {
  const t1 = now;
  const t0 = now - hours * 3_600_000;
  const { min, max } = scaleFor(def, data.points);
  const plot = { min, max, top: M.top, height: H - M.top - M.bottom, left: M.left, width: W - M.left - M.right, t0, t1 };
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'plot', role: 'img' });
  const s = summary(data.points);
  root.setAttribute('aria-label', s
    ? `Verlauf ${def.label}, letzte ${hours === 24 ? '24 Stunden' : '7 Tage'}: Minimum ${formatValue(def, s.min)}, Maximum ${formatValue(def, s.max)}, Mittel ${formatValue(def, Math.round(s.avg * 10) / 10)}, zuletzt ${formatValue(def, s.last)}`
    : `Verlauf ${def.label}: keine Messwerte im Zeitraum`);

  // Zonenbänder und Achsenbeschriftung
  if (def.element !== 'lamp') {
    for (const z of zonesFor({ ...def, scale: { min, max: Math.max(max, def.scale.max) } })) {
      const yTop = yOf(Math.min(z.to, max), plot);
      const yBot = yOf(z.from, plot);
      root.append(svg('rect', { x: plot.left, y: yTop, width: plot.width, height: Math.max(0, yBot - yTop) }, `plot-zone zone-${z.status}`));
    }
  }
  const yLabels = def.element === 'lamp' ? [[0, 'Fehler'], [1, 'OK']] : [[min, String(min)], [max, String(max)], ...(def.thresholds ? [[def.thresholds.warn, String(def.thresholds.warn)], [def.thresholds.crit, String(def.thresholds.crit)]] : [])];
  for (const [v, text] of yLabels) {
    const y = yOf(v, plot);
    root.append(svg('line', { x1: plot.left, x2: plot.left + plot.width, y1: y, y2: y }, 'plot-grid'));
    const t = svg('text', { x: plot.left - 6, y: y + 3, 'text-anchor': 'end' }, 'plot-label');
    t.textContent = text;
    root.append(t);
  }
  const ticks = timeTicks(t0, t1, 5);
  for (const [i, t] of ticks.entries()) {
    const x = plot.left + ((t - t0) / (t1 - t0)) * plot.width;
    // Erste und letzte Marke bündig, damit sie nicht über den Rand ragen.
    const anchor = i === 0 ? 'start' : i === ticks.length - 1 ? 'end' : 'middle';
    const d = new Date(t);
    const label = hours === 24 ? d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
    const n = svg('text', { x, y: H - 10, 'text-anchor': anchor }, 'plot-label');
    n.textContent = label;
    root.append(n);
  }

  // Kurve: Lampen als Stufenlinie, sonst direkt; Lücken bei fehlenden Messwerten.
  for (const seg of buildSegments(data.points, plot)) {
    if (seg.length === 1) root.append(svg('circle', { cx: seg[0][0], cy: seg[0][1], r: 3 }, 'plot-dot'));
    else root.append(svg('path', { d: segmentPath(seg) }, 'plot-line'));
  }
  return { root, s };
}

/** Öffnet die Verlaufsansicht eines Checks. */
export async function openHistory(envId, envLabel, def, opener) {
  ensureDialog();
  ui.opener = opener;
  ui.title.textContent = `${envLabel}: ${def.label}`;
  const show = async (hours) => {
    for (const b of ui.ranges.children) b.setAttribute('aria-pressed', String(Number(b.dataset.hours) === hours));
    ui.chart.replaceChildren(html('p', 'history-wait', 'Lade Verlauf …'));
    ui.facts.textContent = '';
    try {
      const res = await fetch(`/api/history?env=${encodeURIComponent(envId)}&id=${encodeURIComponent(def.id)}&hours=${hours}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const { root, s } = drawChart(def, data, hours, Date.now());
      ui.chart.replaceChildren(root);
      ui.facts.textContent = s
        ? `Minimum ${formatValue(def, s.min)} · Maximum ${formatValue(def, s.max)} · Mittel ${formatValue(def, Math.round(s.avg * 10) / 10)} · zuletzt ${formatValue(def, s.last)} · ${s.count} Messungen`
        : 'Noch keine Messwerte im gewählten Zeitraum.';
    } catch (e) {
      ui.chart.replaceChildren(html('p', 'history-wait', `Verlauf nicht verfügbar (${e.message}).`));
    }
  };
  ui.ranges.replaceChildren(...RANGES.map((r) => {
    const b = html('button', 'btn', r.label);
    b.type = 'button';
    b.dataset.hours = String(r.hours);
    b.addEventListener('click', () => show(r.hours));
    return b;
  }));
  dialog.showModal();
  await show(24);
}
