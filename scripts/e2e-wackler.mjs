#!/usr/bin/env node
/**
 * Wackler-Bericht (LLH-2090): welche e2e-Tests erst im Wiederholversuch grün wurden.
 *
 * `frontend/playwright.config.ts` erlaubt unter CI einen Wiederholversuch (`retries: 1`). Ein Test,
 * der dort grün wird, lässt den Lauf grün und fällt niemandem auf — der Wiederholversuch wäscht ihn
 * still. Playwright markiert ihn im JSON-Bericht als `flaky`; dieses Skript macht die Liste sichtbar
 * (Zusammenfassung des Jobs „e2e-Bericht“ in `.github/workflows/e2e.yml`). Was mit einem Wackler
 * geschieht, regelt `frontend/e2e/AGENTS.md`, „Warten auf einen Zustand“.
 *
 *   node scripts/e2e-wackler.mjs bericht.json
 *
 * `bericht.json` ist ein zusammengeführter JSON-Bericht (`playwright merge-reports --reporter
 * json`). Das Skript meldet nur und endet immer mit 0: der Bericht soll zuerst zeigen, wie viele
 * Wackler es gibt, bevor ein Gate darauf rot wird. Selbsttest: `e2e-wackler.test.mjs`, Schritt 11
 * von `scripts/check-all.sh`.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function sammle(suite, pfad, datei, liste) {
  const hier = suite.file ?? datei;
  for (const spec of suite.specs ?? []) {
    for (const t of spec.tests ?? []) {
      if (t.status === "flaky")
        liste.push({
          datei: hier,
          titel: [...pfad, spec.title].join(" › "),
          projekt: t.projectName,
        });
    }
  }
  for (const kind of suite.suites ?? [])
    sammle(kind, [...pfad, kind.title], hier, liste);
}

/** Alle Tests mit Status `flaky` als `{ datei, titel, projekt }`, in Berichtsreihenfolge. */
export function wacklerAusBericht(bericht) {
  const liste = [];
  // Die oberste Ebene ist die Datei; ihr Titel ist der Dateiname und gehört nicht in den Testtitel.
  for (const suite of bericht.suites ?? [])
    sammle(suite, [], suite.file, liste);
  return liste;
}

/** Abschnitt für `$GITHUB_STEP_SUMMARY`. */
export function alsMarkdown(wackler) {
  if (wackler.length === 0)
    return "### e2e-Wackler\n\nKeine Wackler: kein Test brauchte den Wiederholversuch.\n";
  const zeilen = wackler.map(
    (w) => `| \`${w.datei}\` | ${w.titel} | ${w.projekt} |`,
  );
  return [
    "### e2e-Wackler",
    "",
    `${wackler.length} Tests wurden erst im Wiederholversuch grün. Ursache finden oder den Test mit Begründung streichen (frontend/e2e/AGENTS.md, „Warten auf einen Zustand“).`,
    "",
    "| Datei | Test | Projekt |",
    "| --- | --- | --- |",
    ...zeilen,
    "",
  ].join("\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const pfad = process.argv[2];
  if (!pfad) {
    console.error("Aufruf: node scripts/e2e-wackler.mjs bericht.json");
    process.exit(2);
  }
  process.stdout.write(
    alsMarkdown(wacklerAusBericht(JSON.parse(readFileSync(pfad, "utf8")))),
  );
}
