import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');

function vars(selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  const block = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)].map((m) => [m[1]!, m[2]!]));
}

const lum = (hex: string): number => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
};
export const contrast = (a: string, b: string): number => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

// Textpaare, die app.css tatsächlich verwendet (WCAG AA, normaler Text: 4,5).
const PAIRS: [string, string][] = [
  ['text', 'bg'], ['text', 'surface'], ['text', 'surface-2'], ['text', 'fail-bg'],
  ['text', 'surface-sunken'], ['text-muted', 'surface-sunken'], ['surface', 'pass'], ['surface', 'flaky'], ['surface', 'fail'], ['surface', 'skip'],
  ['link', 'surface-sunken'], ['text-muted', 'bg'], ['text-muted', 'surface'], ['text-muted', 'surface-2'],
  ['link', 'surface'], ['on-accent', 'accent'],
  ['pass', 'surface'], ['pass', 'surface-2'],
  ['flaky', 'surface'], ['flaky', 'surface-2'], ['flaky', 'flaky-bg'],
  ['fail', 'surface'], ['fail', 'surface-2'], ['fail', 'fail-bg'],
];

for (const [name, selector] of [['hell', ':root,\n:root[data-theme="light"]'], ['dunkel', ':root[data-theme="dark"]']] as const) {
  test(`Kontrast ${name}: alle verwendeten Textpaare >= 4,5`, () => {
    const v = vars(selector);
    for (const [fg, bg] of PAIRS) {
      assert.ok(v[fg] && v[bg], `Token fehlt: ${fg}/${bg}`);
      const c = contrast(v[fg]!, v[bg]!);
      assert.ok(c >= 4.5, `${fg} auf ${bg}: ${c.toFixed(2)}`);
    }
  });
}

test('Kontrast: Markenfarben sind unverändert (eggs)', () => {
  const light = vars(':root,\n:root[data-theme="light"]');
  assert.equal(light.accent?.toLowerCase(), '#fab900');
  assert.equal(light.text?.toLowerCase(), '#28262c');
});
