/**
 * Selbsttest der e2e-Verteilung nach Laufzeit (`e2e-anteile.mjs`, LFH-1117) — läuft in Schritt 11
 * des Gates.
 *
 * Die Verteilung irrt still: eine Datei, die in keinem Anteil landet, fährt nie, und keiner der
 * vier Pflicht-Checks wird rot. Eine Datei in zwei Anteilen kostet nur Zeit. Geprüft wird deshalb
 * zuerst die Vollständigkeit, dann das Gleichgewicht und die Stabilität über Prozesse hinweg
 * (die Config läuft in jedem Worker erneut und muss dieselbe Menge ergeben).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { leseAnteil, verteile, laufzeitenAusBerichten, bilanz } from './e2e-anteile.mjs';

const SKRIPT = fileURLToPath(new URL('./e2e-anteile.mjs', import.meta.url));

const einheit = (projekt, datei) => ({ projekt, datei });
const schluessel = (e) => `${e.projekt}:${e.datei}`;

test('Anteil: „k/n" mit 1 ≤ k ≤ n, sonst ein Fehler mit dem Wert', () => {
  assert.deepEqual(leseAnteil('2/4'), { nummer: 2, gesamt: 4 });
  assert.deepEqual(leseAnteil(' 1/1 '), { nummer: 1, gesamt: 1 });
  for (const falsch of ['0/4', '5/4', '2', '2/0', 'a/4', '2/4/1', '']) {
    assert.throws(() => leseAnteil(falsch), new RegExp(`'${falsch}'`));
  }
});

test('jede Einheit landet in genau einem Anteil', () => {
  const einheiten = [];
  for (let i = 0; i < 37; i += 1) einheiten.push(einheit('chromium', `d${i}.spec.ts`));
  einheiten.push(einheit('firefox', 'd3.spec.ts'), einheit('webkit', 'd3.spec.ts'));
  const laufzeiten = { chromium: { 'd1.spec.ts': 900, 'd2.spec.ts': 5 }, firefox: {} };
  const anteile = verteile(einheiten, laufzeiten, 4);
  assert.equal(anteile.length, 4);
  const alle = anteile.flat().map(schluessel).sort();
  assert.deepEqual(alle, einheiten.map(schluessel).sort());
});

test('verteilt nach Laufzeit, nicht nach Anzahl: die langsamen Dateien liegen getrennt', () => {
  // Das Muster des Befunds: drei langsame Dateien stehen alphabetisch nebeneinander.
  const laufzeiten = {
    chromium: { 'a.spec.ts': 60, 'b.spec.ts': 60, 'f.spec.ts': 900, 'g1.spec.ts': 700, 'g3.spec.ts': 400 },
  };
  const einheiten = ['a', 'b', 'f', 'g1', 'g3', 'x', 'y'].map((d) => einheit('chromium', `${d}.spec.ts`));
  const anteile = verteile(einheiten, laufzeiten, 3);
  const wo = (datei) => anteile.findIndex((a) => a.some((e) => e.datei === datei));
  assert.notEqual(wo('f.spec.ts'), wo('g1.spec.ts'));
  assert.notEqual(wo('f.spec.ts'), wo('g3.spec.ts'));
  assert.notEqual(wo('g1.spec.ts'), wo('g3.spec.ts'));
});

test('gleiche Eingabe in anderer Reihenfolge ergibt dieselben Anteile', () => {
  const laufzeiten = { chromium: { 'a.spec.ts': 10, 'b.spec.ts': 10, 'c.spec.ts': 10, 'd.spec.ts': 30 } };
  const einheiten = ['a', 'b', 'c', 'd', 'e'].map((d) => einheit('chromium', `${d}.spec.ts`));
  const vorwaerts = verteile(einheiten, laufzeiten, 2).map((a) => a.map(schluessel).sort());
  const rueckwaerts = verteile([...einheiten].reverse(), laufzeiten, 2).map((a) =>
    a.map(schluessel).sort(),
  );
  assert.deepEqual(rueckwaerts, vorwaerts);
});

test('eine Datei ohne Messwert zählt mit dem Median der Tabelle', () => {
  // Median 20: die neue Datei wiegt wie eine mittlere, nicht null (sonst häuften sich neue
  // Specs im leichtesten Anteil) und nicht wie die langsamste.
  const laufzeiten = { chromium: { 'a.spec.ts': 10, 'b.spec.ts': 20, 'c.spec.ts': 1000 } };
  const b = bilanz([einheit('chromium', 'neu.spec.ts')], laufzeiten, 1);
  assert.deepEqual(b, [20]);
  // Leere Tabelle: jede Datei gleich schwer, also nach Anzahl.
  const anteile = verteile(['a', 'b', 'c', 'd'].map((d) => einheit('chromium', `${d}.spec.ts`)), {}, 2);
  assert.deepEqual(
    anteile.map((a) => a.length),
    [2, 2],
  );
});

test('dieselbe Datei in zwei Projekten sind zwei Einheiten mit eigener Laufzeit', () => {
  const laufzeiten = { chromium: { 'd.spec.ts': 100 }, firefox: { 'd.spec.ts': 100 } };
  const anteile = verteile([einheit('chromium', 'd.spec.ts'), einheit('firefox', 'd.spec.ts')], laufzeiten, 2);
  assert.deepEqual(
    anteile.map((a) => a.map(schluessel)),
    [['chromium:d.spec.ts'], ['firefox:d.spec.ts']],
  );
});

/** Ein JSON-Bericht von `playwright merge-reports --reporter json`, auf das Nötige gekürzt. */
function bericht(eintraege) {
  const suites = [];
  for (const [datei, projekt, ...dauern] of eintraege) {
    suites.push({
      file: datei,
      specs: [],
      // Verschachtelt wie bei `test.describe`: die Dauer steckt in der inneren Suite.
      suites: [
        {
          file: datei,
          specs: [
            {
              file: datei,
              tests: [{ projectName: projekt, results: dauern.map((duration) => ({ duration })) }],
            },
          ],
        },
      ],
    });
  }
  return { suites };
}

test('Laufzeiten aus Berichten: Summe je Projekt und Datei, Wiederholungen zählen mit', () => {
  const t = laufzeitenAusBerichten([
    bericht([
      ['a.spec.ts', 'chromium', 30_000, 12_400],
      ['a.spec.ts', 'firefox', 8_000],
      ['b.spec.ts', 'chromium', 400],
    ]),
  ]);
  assert.deepEqual(t, {
    chromium: { 'a.spec.ts': 42, 'b.spec.ts': 1 },
    firefox: { 'a.spec.ts': 8 },
  });
});

test('Laufzeiten aus mehreren Berichten: Mittel über die Berichte, die die Datei enthalten', () => {
  const t = laufzeitenAusBerichten([
    bericht([['a.spec.ts', 'chromium', 100_000]]),
    bericht([
      ['a.spec.ts', 'chromium', 50_000],
      ['b.spec.ts', 'chromium', 20_000],
    ]),
  ]);
  assert.deepEqual(t, { chromium: { 'a.spec.ts': 75, 'b.spec.ts': 20 } });
});

test('CLI aktualisieren: schreibt die Tabelle sortiert und meldet bisherige und neue Anteile', () => {
  const dir = mkdtempSync(join(tmpdir(), 'e2e-anteile-'));
  const quelle = join(dir, 'bericht.json');
  const tabelle = join(dir, 'laufzeiten.json');
  writeFileSync(
    quelle,
    JSON.stringify(
      bericht([
        ['z.spec.ts', 'chromium', 60_000],
        ['m.spec.ts', 'chromium', 60_000],
        ['a.spec.ts', 'chromium', 120_000],
      ]),
    ),
  );
  // Die bisherige Tabelle hält z für langsam: z allein, m und a zusammen.
  writeFileSync(tabelle, JSON.stringify({ chromium: { 'z.spec.ts': 1000, 'a.spec.ts': 1 } }));
  const ausgabe = execFileSync(
    process.execPath,
    [SKRIPT, 'aktualisieren', '--aus', quelle, '--nach', tabelle, '--anteile', '2'],
    { encoding: 'utf8' },
  );
  assert.equal(
    readFileSync(tabelle, 'utf8'),
    '{\n  "chromium": {\n    "a.spec.ts": 120,\n    "m.spec.ts": 60,\n    "z.spec.ts": 60\n  }\n}\n',
  );
  const [bisher, neu] = ausgabe.split('Verteilt nach der neuen Tabelle:');
  assert.match(bisher, /bisherigen Tabelle/);
  assert.match(bisher, /\| 1\/2 \| 1,0 min \|\n\| 2\/2 \| 3,0 min \|/);
  assert.match(bisher, /über dem Mittel: 1,0 min/);
  assert.match(neu, /\| 1\/2 \| 2,0 min \|\n\| 2\/2 \| 2,0 min \|/);
});
