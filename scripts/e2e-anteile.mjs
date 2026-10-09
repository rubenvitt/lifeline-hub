#!/usr/bin/env node
/**
 * e2e-Anteile nach Laufzeit (LFH-1117): welche Spec-Dateien ein CI-Shard `e2e k/4` fährt.
 *
 * Playwrights `--shard` schneidet die Suite nach TESTZAHL in Dateireihenfolge. Die langsamen
 * Layout-Gates stehen alphabetisch nebeneinander (`fokus-verdeckung`, `gate1-ueberlauf`,
 * `gate3-trefflaeche`) und landeten alle im zweiten Anteil: gemessen 33–36 min gegen 19–26 min
 * der übrigen drei, bei gleicher Testzahl. Hier wird stattdessen nach gemessener Laufzeit
 * verteilt (längste zuerst in den jeweils leichtesten Anteil). Die Messwerte stehen in
 * `frontend/e2e/laufzeiten.json`; `frontend/playwright.config.ts` wählt damit die Dateien des
 * Anteils `PW_SHARD`.
 *
 * Die Einheit ist (Projekt, Datei): Playwright teilt eine Datei ohne `mode: 'parallel'` ohnehin
 * nicht auf, und Firefox/WebKit fahren dieselbe Druck-Spec mit eigener Laufzeit.
 *
 * Auffrischen der Tabelle (der Job „Testberichte zusammenführen" in `.github/workflows/ci.yml`
 * legt sie fertig als Artefakt `e2e-laufzeiten` ab und zeigt die Bilanz in der Zusammenfassung):
 *
 *   node scripts/e2e-anteile.mjs aktualisieren --aus bericht.json [--aus …] \
 *     --nach frontend/e2e/laufzeiten.json [--anteile 4]
 *
 * `bericht.json` ist ein zusammengeführter JSON-Bericht (`playwright merge-reports --reporter
 * json`). Selbsttest: `e2e-anteile.test.mjs`, Schritt 11 von `scripts/check-all.sh`.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

/** `"k/n"` → `{ nummer: k, gesamt: n }`; alles andere ist ein Fehler, nie ein stiller Vollauf. */
export function leseAnteil(text) {
  const treffer = /^\s*(\d+)\/(\d+)\s*$/.exec(text);
  const nummer = treffer ? Number(treffer[1]) : NaN;
  const gesamt = treffer ? Number(treffer[2]) : NaN;
  if (!(gesamt >= 1 && nummer >= 1 && nummer <= gesamt)) {
    throw new Error(`Kein gültiger Anteil: '${text}' (erwartet k/n mit 1 ≤ k ≤ n, etwa 2/4).`);
  }
  return { nummer, gesamt };
}

/**
 * Gewicht einer Datei ohne Messwert: der Median der Tabelle. Null häufte neue Specs im
 * leichtesten Anteil, der größte Wert machte jede neue Spec zum Ausreißer. Leere Tabelle:
 * alle gleich schwer, die Verteilung geht dann nach Anzahl.
 */
function ersatzgewicht(laufzeiten) {
  const werte = Object.values(laufzeiten)
    .flatMap((dateien) => Object.values(dateien))
    .sort((a, b) => a - b);
  if (werte.length === 0) return 1;
  const mitte = Math.floor(werte.length / 2);
  return werte.length % 2 ? werte[mitte] : (werte[mitte - 1] + werte[mitte]) / 2;
}

function gewichter(laufzeiten) {
  const ersatz = ersatzgewicht(laufzeiten);
  return (e) => laufzeiten[e.projekt]?.[e.datei] ?? ersatz;
}

/**
 * Teilt die Einheiten `{ projekt, datei }` auf `gesamt` Anteile: schwerste zuerst, jeweils in
 * den leichtesten Anteil (bei Gleichstand der vordere). Reihenfolge der Eingabe egal — die
 * Config läuft in jedem Worker-Prozess erneut und muss dort dieselbe Menge ergeben.
 */
export function verteile(einheiten, laufzeiten, gesamt) {
  const gewicht = gewichter(laufzeiten);
  const name = (e) => `${e.projekt}\u0000${e.datei}`;
  const sortiert = [...einheiten].sort(
    (a, b) => gewicht(b) - gewicht(a) || (name(a) < name(b) ? -1 : name(a) > name(b) ? 1 : 0),
  );
  const anteile = Array.from({ length: gesamt }, () => []);
  const last = new Array(gesamt).fill(0);
  for (const e of sortiert) {
    let ziel = 0;
    for (let i = 1; i < gesamt; i += 1) if (last[i] < last[ziel]) ziel = i;
    anteile[ziel].push(e);
    last[ziel] += gewicht(e);
  }
  return anteile;
}

/**
 * Testzeit je Anteil in Sekunden: verteilt nach `verteilTabelle`, gezählt nach `messTabelle`.
 * Mit zwei Tabellen zeigt das, wie die bisherige Verteilung unter neuen Messwerten trägt.
 */
export function bilanz(einheiten, verteilTabelle, gesamt, messTabelle = verteilTabelle) {
  const gewicht = gewichter(messTabelle);
  return verteile(einheiten, verteilTabelle, gesamt).map((anteil) =>
    anteil.reduce((summe, e) => summe + gewicht(e), 0),
  );
}

function sammle(suite, summen) {
  for (const spec of suite.specs ?? []) {
    for (const t of spec.tests ?? []) {
      const projekt = (summen[t.projectName] ??= {});
      const ms = (t.results ?? []).reduce((s, r) => s + (r.duration ?? 0), 0);
      projekt[spec.file] = (projekt[spec.file] ?? 0) + ms;
    }
  }
  for (const kind of suite.suites ?? []) sammle(kind, summen);
}

/**
 * Laufzeit je Projekt und Datei in ganzen Sekunden (mindestens 1) aus JSON-Berichten. Jeder
 * Versuch zählt, auch die Wiederholung: sie belegt den Worker genauso. Mehrere Berichte werden
 * gemittelt, je Datei über die Berichte, in denen sie vorkommt.
 */
export function laufzeitenAusBerichten(berichte) {
  const proBericht = berichte.map((b) => {
    const summen = {};
    for (const suite of b.suites ?? []) sammle(suite, summen);
    return summen;
  });
  const ergebnis = {};
  const projekte = [...new Set(proBericht.flatMap((s) => Object.keys(s)))].sort();
  for (const projekt of projekte) {
    const dateien = [...new Set(proBericht.flatMap((s) => Object.keys(s[projekt] ?? {})))].sort();
    ergebnis[projekt] = {};
    for (const datei of dateien) {
      const werte = proBericht.map((s) => s[projekt]?.[datei]).filter((w) => w !== undefined);
      const mittel = werte.reduce((a, b) => a + b, 0) / werte.length;
      ergebnis[projekt][datei] = Math.max(1, Math.round(mittel / 1000));
    }
  }
  return ergebnis;
}

function minuten(sekunden) {
  return `${(sekunden / 60).toFixed(1).replace('.', ',')} min`;
}

function tabelleMd(titel, summen) {
  const mittel = summen.reduce((a, b) => a + b, 0) / summen.length;
  const zeilen = summen.map((s, i) => `| ${i + 1}/${summen.length} | ${minuten(s)} |`);
  return [
    titel,
    '',
    '| Anteil | Testzeit (Summe über die Worker) |',
    '| --- | --- |',
    ...zeilen,
    '',
    `Langsamster Anteil über dem Mittel: ${minuten(Math.max(...summen) - mittel)}.`,
    '',
  ].join('\n');
}

function aktualisieren(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      aus: { type: 'string', multiple: true },
      nach: { type: 'string' },
      anteile: { type: 'string', default: '4' },
    },
  });
  if (!values.aus?.length || !values.nach) {
    throw new Error('Aufruf: aktualisieren --aus <bericht.json> [--aus …] --nach <laufzeiten.json>');
  }
  const gesamt = leseAnteil(`1/${values.anteile}`).gesamt;
  const neu = laufzeitenAusBerichten(values.aus.map((p) => JSON.parse(readFileSync(p, 'utf8'))));
  const bisher = existsSync(values.nach) ? JSON.parse(readFileSync(values.nach, 'utf8')) : {};
  const einheiten = Object.entries(neu).flatMap(([projekt, dateien]) =>
    Object.keys(dateien).map((datei) => ({ projekt, datei })),
  );
  writeFileSync(values.nach, `${JSON.stringify(neu, null, 2)}\n`);
  return [
    '### e2e-Anteile nach Laufzeit',
    '',
    tabelleMd('Gemessen, verteilt nach der bisherigen Tabelle:', bilanz(einheiten, bisher, gesamt, neu)),
    tabelleMd('Verteilt nach der neuen Tabelle:', bilanz(einheiten, neu, gesamt)),
  ].join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [befehl, ...rest] = process.argv.slice(2);
  if (befehl !== 'aktualisieren') {
    console.error("Unbekannter Befehl. Aufruf: node scripts/e2e-anteile.mjs aktualisieren --aus … --nach …");
    process.exit(2);
  }
  console.log(aktualisieren(rest));
}
