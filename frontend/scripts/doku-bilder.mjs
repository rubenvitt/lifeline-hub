#!/usr/bin/env node
/**
 * Bildlauf der Anwenderdoku (`pnpm doku:bilder`, `docs/anwender/AGENTS.md`, „Bilder“).
 *
 * Ohne Argumente fährt er jedes Kapitel in einem eigenen Playwright-Lauf, also mit eigener
 * Temp-DB und frischem Demo-Import: die Bilder-Specs füllen Demo-Lücken über die API (neue
 * Benutzer, abgeschlossene Einsätze, Kopplungen), und in einem gemeinsamen Lauf stünden diese
 * Daten in den Bildern der Kapitel danach. So sieht jedes Kapitel dieselben Daten wie beim
 * Einzellauf mit `--grep <kapitel>`.
 *
 * Mit Argumenten reicht er sie an einen einzigen Lauf durch (`--grep <kapitel>`, Dateipfade). Ein
 * `--`, das pnpm durchreicht (`pnpm doku:bilder -- --grep …`), fällt weg.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const frontend = fileURLToPath(new URL('..', import.meta.url));
const playwright = join(frontend, 'node_modules', '.bin', 'playwright');
const basis = ['test', '-c', 'playwright.doku.config.ts'];

function lauf(argumente) {
  const ergebnis = spawnSync(playwright, [...basis, ...argumente], {
    cwd: frontend,
    stdio: 'inherit',
  });
  return ergebnis.status ?? 1;
}

const argumente = process.argv.slice(2).filter((a) => a !== '--');
if (argumente.length > 0) process.exit(lauf(argumente));

const specs = readdirSync(join(frontend, 'e2e', 'doku-bilder'))
  .filter((datei) => datei.endsWith('.bilder.ts'))
  .sort();
const rot = [];
for (const spec of specs) {
  console.log(`\n=== ${spec} ===`);
  if (lauf([`e2e/doku-bilder/${spec}`]) !== 0) rot.push(spec);
}
if (rot.length > 0) {
  console.error(`\nRot: ${rot.join(', ')}`);
  process.exit(1);
}
console.log(`\n${specs.length} Kapitel fotografiert.`);
