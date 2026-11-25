/**
 * Selbsttest des Wackler-Berichts (`e2e-wackler.mjs`, LLH-2090) — läuft in Schritt 11 des Gates.
 *
 * Der Bericht irrt still in zwei Richtungen: übersieht er einen Test, der erst im zweiten Versuch
 * grün wurde, versteckt der Wiederholversuch ihn weiter; zählt er einen roten oder übersprungenen
 * Test mit, jagt jemand einen Wackler, den es nicht gibt.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { wacklerAusBericht, alsMarkdown } from "./e2e-wackler.mjs";

const fall = (title, status, projectName = "chromium") => ({
  title,
  tests: [{ projectName, status, results: [] }],
});

const BERICHT = {
  suites: [
    {
      file: "a.spec.ts",
      specs: [fall("grün", "expected"), fall("wackelt", "flaky")],
      suites: [
        {
          title: "Gruppe",
          file: "a.spec.ts",
          specs: [
            fall("wackelt tief", "flaky", "webkit"),
            fall("rot", "unexpected"),
          ],
        },
      ],
    },
    { file: "b.spec.ts", specs: [fall("übersprungen", "skipped")] },
  ],
};

test("nimmt genau die Tests mit Status flaky, auch aus verschachtelten Gruppen", () => {
  assert.deepEqual(wacklerAusBericht(BERICHT), [
    { datei: "a.spec.ts", titel: "wackelt", projekt: "chromium" },
    { datei: "a.spec.ts", titel: "Gruppe › wackelt tief", projekt: "webkit" },
  ]);
});

test("ein Bericht ohne Wackler ergibt eine leere Liste und eine Zeile ohne Tabelle", () => {
  assert.deepEqual(
    wacklerAusBericht({
      suites: [{ file: "x", specs: [fall("g", "expected")] }],
    }),
    [],
  );
  assert.match(alsMarkdown([]), /keine Wackler/i);
  assert.doesNotMatch(alsMarkdown([]), /\|/);
});

test("Markdown nennt Zahl, Datei, Titel und Projekt je Wackler", () => {
  const md = alsMarkdown(wacklerAusBericht(BERICHT));
  assert.match(md, /2 Tests/);
  assert.match(md, /\| `a\.spec\.ts` \| Gruppe › wackelt tief \| webkit \|/);
});
