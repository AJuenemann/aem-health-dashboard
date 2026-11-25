import { STATUS_ICON, formatValue } from './logic.js';
import { SWEEP, arcPath, counterDigits, litSegments, polar, valueToAngle, zoneAt, zonesFor } from './geometry.js';

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

/**
 * Zeigerinstrument (Halbkreis-Skala mit Farbzonen, Strichen und Nadel).
 * `zones`: [{from,to,status}], `format(value)` liefert den Text im Zifferblatt.
 */
export function createGauge({ min, max, zones, format, big = false }) {
  const root = svg('svg', { viewBox: '0 0 200 150', 'aria-hidden': 'true', focusable: 'false' }, `gauge${big ? ' gauge-big' : ''}`);
  root.append(svg('circle', { cx: 100, cy: 100, r: 92 }, 'gauge-face'));
  for (const z of zones) {
    const a0 = valueToAngle(z.from, min, max);
    const a1 = valueToAngle(z.to, min, max);
    root.append(svg('path', { d: arcPath(100, 100, 70, a0, a1) }, `gauge-zone zone-${z.status}`));
  }
  // Skalenstriche: 10 Intervalle, jeder zweite lang.
  for (let i = 0; i <= 10; i++) {
    const a = SWEEP.start + ((SWEEP.end - SWEEP.start) * i) / 10;
    const [x0, y0] = polar(100, 100, i % 5 === 0 ? 74 : 76, a);
    const [x1, y1] = polar(100, 100, 82, a);
    root.append(svg('line', { x1: x0, y1: y0, x2: x1, y2: y1 }, i % 5 === 0 ? 'gauge-tick gauge-tick-major' : 'gauge-tick'));
  }
  const lo = polar(100, 100, 70, SWEEP.start);
  const hi = polar(100, 100, 70, SWEEP.end);
  const scaleText = (p, t, anchor) => {
    const n = svg('text', { x: p[0], y: p[1] + 14, 'text-anchor': anchor }, 'gauge-scale');
    n.textContent = t;
    return n;
  };
  root.append(scaleText(lo, String(min), 'middle'), scaleText(hi, String(max), 'middle'));

  const reading = svg('text', { x: 100, y: 128, 'text-anchor': 'middle' }, 'gauge-reading');
  const needle = svg('g', {}, 'gauge-needle');
  needle.append(svg('line', { x1: 100, y1: 104, x2: 100, y2: 34 }, 'gauge-needle-line'));
  root.append(reading, needle, svg('circle', { cx: 100, cy: 100, r: 6 }, 'gauge-hub'), svg('circle', { cx: 100, cy: 100, r: 2.5 }, 'gauge-hub-dot'));

  const setAngle = (a) => needle.style.setProperty('transform', `rotate(${a}deg)`);
  setAngle(SWEEP.start);

  return {
    el: root,
    update(value, status) {
      root.dataset.status = status;
      reading.textContent = format(value);
      setAngle(value === null ? SWEEP.start : valueToAngle(value, min, max));
    },
  };
}

const LAMP_SYMBOL = { ok: 'M-9 1 L-3 8 L10 -7', warn: 'M0 -10 V3 M0 9 V9.1', crit: 'M-8 -8 L8 8 M8 -8 L-8 8' };

/** Leuchtmelder: dunkle Fassung, Linse mit Glanz, Formsymbol innen (Status nie nur als Farbe), Beschriftungsschild. */
export function createLamp({ plate } = {}) {
  const el = html('div', 'lamp');
  el.setAttribute('aria-hidden', 'true');
  const bezel = html('div', 'lamp-bezel');
  const lens = html('div', 'lamp-lens');
  const icon = svg('svg', { viewBox: '-14 -14 28 28', focusable: 'false' }, 'lamp-icon');
  const path = svg('path', {}, 'lamp-symbol');
  const unknown = svg('text', { x: 0, y: 7, 'text-anchor': 'middle' }, 'lamp-unknown');
  unknown.textContent = '?';
  icon.append(path, unknown);
  lens.append(icon);
  bezel.append(lens);
  el.append(bezel);
  if (plate) el.append(html('div', 'lamp-plate', plate));
  return {
    el,
    update(_value, status) {
      el.dataset.status = status;
      if (LAMP_SYMBOL[status]) path.setAttribute('d', LAMP_SYMBOL[status]);
      path.style.display = LAMP_SYMBOL[status] ? '' : 'none';
      unknown.style.display = LAMP_SYMBOL[status] ? 'none' : '';
    },
  };
}

/** Rollenzählwerk mit mechanisch wirkenden Ziffernrollen. */
export function createCounter({ max, unit }) {
  const count = Math.max(2, String(Math.round(max)).length);
  const el = html('div', 'counter');
  el.setAttribute('aria-hidden', 'true');
  const window_ = html('div', 'counter-window');
  const reels = [];
  for (let i = 0; i < count; i++) {
    const cell = html('span', 'counter-digit');
    const reel = html('span', 'counter-reel');
    for (let d = 0; d < 10; d++) reel.append(html('span', '', String(d)));
    cell.append(reel);
    window_.append(cell);
    reels.push(reel);
  }
  const over = html('span', 'counter-over', '+');
  const dash = html('span', 'counter-none', '–');
  window_.append(over, dash);
  el.append(window_);
  if (unit) el.append(html('div', 'counter-unit', unit));

  return {
    el,
    update(value, status) {
      el.dataset.status = status;
      const none = value === null;
      el.dataset.none = String(none);
      over.hidden = true;
      if (none) return;
      const { digits, over: isOver } = counterDigits(value, count);
      digits.forEach((d, i) => reels[i].style.setProperty('--d', d));
      over.hidden = !isOver;
    },
  };
}

/** Balkenanzeige (Pegel) aus Segmenten, Farbe je Segment nach Zone, dazu der Messwert als Text. */
export function createBar({ min, max, zones, format }) {
  const SEG = 20;
  const el = html('div', 'bar');
  el.setAttribute('aria-hidden', 'true');
  const track = html('div', 'bar-track');
  const segs = [];
  for (let i = 0; i < SEG; i++) {
    const s = html('span', `bar-seg zone-${zoneAt(zones, min + ((i + 0.5) / SEG) * (max - min))}`);
    track.append(s);
    segs.push(s);
  }
  const reading = html('div', 'bar-reading');
  const scale = html('div', 'bar-scale');
  scale.append(html('span', '', String(min)), html('span', '', String(max)));
  el.append(track, scale, reading);
  return {
    el,
    update(value, status) {
      el.dataset.status = status;
      reading.textContent = format(value);
      const lit = value === null ? 0 : litSegments(value, min, max, SEG);
      segs.forEach((s, i) => s.classList.toggle('lit', i < lit));
    },
  };
}

/** Schauglas: Füllstand als Flüssigkeitssäule, Marken an den Schwellen, dazu der Messwert als Text. */
export function createGlass({ min, max, zones, format }) {
  const H = 84; // Innenhöhe, y von 11 bis 95
  const yOf = (v) => 11 + H - (H * (v - min)) / (max - min);
  const el = html('div', 'glass');
  el.setAttribute('aria-hidden', 'true');
  const root = svg('svg', { viewBox: '0 0 120 106', focusable: 'false' }, 'glass-svg');
  const liquid = svg('rect', { x: 38, width: 44, rx: 4, y: 95, height: 0 }, 'glass-liquid');
  root.append(svg('rect', { x: 35, y: 8, width: 50, height: 90, rx: 8 }, 'glass-body'), liquid);
  root.append(svg('line', { x1: 43, y1: 16, x2: 43, y2: 60 }, 'glass-shine'));
  // Marken an den Zonengrenzen (Schwellen), nicht an Anfang und Ende der Skala.
  for (const z of zones.slice(1)) {
    root.append(svg('line', { x1: 85, y1: yOf(z.from), x2: 93, y2: yOf(z.from) }, `glass-mark zone-${z.status}`));
    const t = svg('text', { x: 96, y: yOf(z.from) + 3.5 }, 'glass-scale');
    t.textContent = String(z.from);
    root.append(t);
  }
  const reading = html('div', 'glass-reading');
  el.append(root, reading);
  return {
    el,
    update(value, status) {
      el.dataset.status = status;
      reading.textContent = format(value);
      const f = value === null ? 0 : Math.min(Math.max((value - min) / (max - min), 0), 1);
      liquid.setAttribute('height', String(H * f));
      liquid.setAttribute('y', String(11 + H - H * f));
    },
  };
}

/** Wählt das Messgerät nach `def.element`. Schnittstelle: `{ el, update(check) }`. */
export function createInstrument(def) {
  const format = (v) => formatValue(def, v);
  let inner;
  switch (def.element) {
    case 'gauge':
      inner = createGauge({ min: def.scale.min, max: def.scale.max, zones: zonesFor(def), format });
      break;
    case 'counter':
      inner = createCounter({ max: def.scale.max, unit: def.unit });
      break;
    case 'bar':
      inner = createBar({ min: def.scale.min, max: def.scale.max, zones: zonesFor(def), format });
      break;
    case 'glass':
      inner = createGlass({ min: def.scale.min, max: def.scale.max, zones: zonesFor(def), format });
      break;
    default:
      inner = createLamp({ plate: def.short });
  }
  return { el: inner.el, update: (check) => inner.update(check.value, check.status) };
}
