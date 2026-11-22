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
  // Außerhalb von `e2e/` gilt kein Riegel.
  'src/probe.ts': "await page.waitForLoadState('networkidle');",
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
    writeFileSync(join(wurzel, pfad), `declare const page: any;\n${inhalt}\n`);
  }
  const lauf = spawnSync(OXLINT, ['--format', 'json', '-c', '.oxlintrc.json', '.'], {
    cwd: wurzel,
    encoding: 'utf8',
  });
  expect(lauf.stdout, lauf.stderr).toContain('"diagnostics"');
  befunde = (JSON.parse(lauf.stdout) as { diagnostics: Diagnose[] }).diagnostics.filter((d) =>
    d.code.startsWith('lfh('),
  );
}, 60_000);

afterAll(() => {
  if (wurzel) rmSync(wurzel, { recursive: true, force: true });
});

/** Befunde einer Musterdatei als „Zeile Regel“, Zeile ab der ersten Musterzeile gezählt. */
const von = (pfad: string): string[] =>
  befunde
    .filter((d) => d.filename === pfad)
    .map((d) => `${d.labels[0].span.line - 1} ${d.code}`)
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

  it('meldet nichts für andere Werte, Template-Literale, unterdrückte Zeilen und außerhalb von e2e', () => {
    for (const pfad of ['e2e/gegenprobe.spec.ts', 'e2e/unterdrueckt.spec.ts', 'src/probe.ts'])
      expect(von(pfad), pfad).toEqual([]);
  });
});
