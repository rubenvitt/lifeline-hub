import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Probe-Test für das Riegel-Plugin `lfh` (LLH-2020, Regel in `frontend/AGENTS.md`,
 * „Lint-Disziplin“). Die JS-Plugin-API von oxlint ist Alpha: löst ein Update die Selektoren nicht
 * mehr auf, lädt das Plugin weiter und meldet still nichts. Dieser Test lintet Musterdateien mit der
 * echten Konfiguration und dem echten Plugin und zählt die Befunde je Datei.
 *
 * Die Musterdateien liegen in einem Temp-Verzeichnis, nicht unter `e2e/`, damit der normale
 * Lint-Lauf sie nicht sieht.
 */

const FRONTEND = join(dirname(fileURLToPath(import.meta.url)), '..');
const OXLINT = join(FRONTEND, 'node_modules', '.bin', 'oxlint');

/** Die vier Riegel als je eine Zeile, in der Reihenfolge von `riegel-plugin.js`. */
const VERSTOESSE = [
  "await page.waitForLoadState('networkidle');",
  "await page.goto('/', { waitUntil: 'networkidle' });",
  "await page.getByRole('button', { name: 'Neuer Einsatz' }).click();",
  "await page.getByLabel('Benutzername').fill('admin');",
].join('\n');

/** LLH-2067: eigenes Warten auf antds Einblend-Klassen, als String- und als Regex-Literal. */
const EINBLENDUNG = [
  "await expect(page.locator('.ant-zoom-appear, .ant-zoom-enter')).toHaveCount(0);",
  'await expect(page.locator(".ant-modal")).not.toHaveClass(/ant-zoom-big-appear/);',
].join('\n');

/** LLH-2090: feste Wartezeit statt Warten auf einen Zustand. */
const WARTEZEIT = 'await page.waitForTimeout(500);';

const MUSTER: Record<string, string> = {
  'e2e/probe-aussen.spec.ts': VERSTOESSE,
  // Steht in der Ausnahmeliste des Anmeldeformular-Riegels.
  'e2e/kernfluss.spec.ts': VERSTOESSE,
  'e2e/doku-bilder/probe.bilder.ts': VERSTOESSE,
  'e2e/gegenprobe.spec.ts': [
    "await page.waitForLoadState('load');",
    "await page.goto('/', { waitUntil: 'load' });",
    "await page.getByRole('button', { name: 'Speichern' }).click();",
    "await page.getByLabel('Passwort').fill('geheim');",
    'await page.waitForLoadState(`networkidle`);',
  ].join('\n'),
  'e2e/unterdrueckt.spec.ts': [
    '// oxlint-disable-next-line lfh/e2e-riegel -- Probe: Unterdrücken mit Begründung',
    "await page.waitForLoadState('networkidle');",
  ].join('\n'),
  // LLH-2067: antds Einblend-Klassen kennt nur der Dialog-Kern (und der Bildlauf).
  'e2e/einblendung.spec.ts': EINBLENDUNG,
  'e2e/dialog-kern.ts': EINBLENDUNG,
  'e2e/doku-bilder/einblendung.bilder.ts': EINBLENDUNG,
  // LLH-2090: neue Specs warten nie fest; der Bestand steht in der Ausnahmeliste.
  'e2e/wartezeit.spec.ts': WARTEZEIT,
  'e2e/lagekarte-touch.spec.ts': WARTEZEIT,
  'e2e/wartezeit-unterdrueckt.spec.ts': [
    '// oxlint-disable-next-line lfh/e2e-wartezeit -- Probe: Doppeltipp-Fenster abwarten',
    WARTEZEIT,
  ].join('\n'),
  // Außerhalb von `e2e/` gilt kein Riegel.
  'src/probe.ts': "await page.waitForLoadState('networkidle');",
  // Wie unter ESLint: ein führender Unterstrich macht nichts unbenutzt-erlaubt (Review LLH-2020).
  'src/unbenutzt.ts': ['export function f(_arg: number) {', '  const _x = 1;', '}'].join('\n'),
};

interface Diagnose {
  code: string;
  filename: string;
  labels: { span: { line: number } }[];
}

let wurzel = '';
let befunde: Diagnose[] = [];

beforeAll(() => {
  wurzel = mkdtempSync(join(tmpdir(), 'riegel-probe-'));
  mkdirSync(join(wurzel, 'lint'));
  copyFileSync(join(FRONTEND, '.oxlintrc.json'), join(wurzel, '.oxlintrc.json'));
  copyFileSync(
    join(FRONTEND, 'lint', 'riegel-plugin.js'),
    join(wurzel, 'lint', 'riegel-plugin.js'),
  );
  for (const [pfad, inhalt] of Object.entries(MUSTER)) {
    mkdirSync(dirname(join(wurzel, pfad)), { recursive: true });
    const kopf = inhalt.includes('page.') ? 'declare const page: any;\n' : '';
    writeFileSync(join(wurzel, pfad), `${kopf}${inhalt}\n`);
  }
  const lauf = spawnSync(OXLINT, ['--format', 'json', '-c', '.oxlintrc.json', '.'], {
    cwd: wurzel,
    encoding: 'utf8',
  });
  expect(lauf.stdout, lauf.stderr).toContain('"diagnostics"');
  befunde = (JSON.parse(lauf.stdout) as { diagnostics: Diagnose[] }).diagnostics.filter(
    (d) => d.code?.startsWith('lfh(') || d.code === 'eslint(no-unused-vars)',
  );
}, 60_000);

afterAll(() => {
  if (wurzel) rmSync(wurzel, { recursive: true, force: true });
});

/** Befunde einer Musterdatei als „Zeile Regel“, Zeile ab der ersten Musterzeile gezählt. */
const von = (pfad: string): string[] =>
  befunde
    .filter((d) => d.filename === pfad)
    .map((d) => `${d.labels[0].span.line - (MUSTER[pfad].includes('page.') ? 1 : 0)} ${d.code}`)
    .sort();

describe('Riegel-Plugin lfh (LLH-2020)', () => {
  it('meldet außerhalb der Ausnahmeliste alle vier Riegel', () => {
    expect(von('e2e/probe-aussen.spec.ts')).toEqual([
      '1 lfh(e2e-riegel)',
      '2 lfh(e2e-riegel)',
      '3 lfh(e2e-riegel)',
      '4 lfh(e2e-anmeldeformular)',
    ]);
  });

  it('lässt Specs der Ausnahmeliste das Anmeldeformular füllen, die übrigen Riegel gelten', () => {
    for (const pfad of ['e2e/kernfluss.spec.ts', 'e2e/doku-bilder/probe.bilder.ts'])
      expect(von(pfad), pfad).toEqual([
        '1 lfh(e2e-riegel)',
        '2 lfh(e2e-riegel)',
        '3 lfh(e2e-riegel)',
      ]);
  });

  it('verbietet das Warten auf Einblend-Klassen außer im Dialog-Kern und im Bildlauf', () => {
    expect(von('e2e/einblendung.spec.ts')).toEqual([
      '1 lfh(e2e-einblendung)',
      '2 lfh(e2e-einblendung)',
    ]);
    expect(von('e2e/dialog-kern.ts')).toEqual([]);
    expect(von('e2e/doku-bilder/einblendung.bilder.ts')).toEqual([]);
  });

  it('verbietet feste Wartezeiten außer im Bestand und mit begründeter Unterdrückung (LLH-2090)', () => {
    expect(von('e2e/wartezeit.spec.ts')).toEqual(['1 lfh(e2e-wartezeit)']);
    expect(von('e2e/lagekarte-touch.spec.ts')).toEqual([]);
    expect(von('e2e/wartezeit-unterdrueckt.spec.ts')).toEqual([]);
  });

  it('meldet nichts für andere Werte, Template-Literale, unterdrückte Zeilen und außerhalb von e2e', () => {
    for (const pfad of ['e2e/gegenprobe.spec.ts', 'e2e/unterdrueckt.spec.ts', 'src/probe.ts'])
      expect(von(pfad), pfad).toEqual([]);
  });

  it('meldet unbenutzte Namen auch mit führendem Unterstrich, wie früher ESLint', () => {
    expect(von('src/unbenutzt.ts')).toEqual([
      '1 eslint(no-unused-vars)',
      '2 eslint(no-unused-vars)',
    ]);
  });
});
