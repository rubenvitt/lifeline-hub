#!/usr/bin/env node
/**
 * Alpha-Kanal der Desktop-Hülle (LLH-1280): entscheidet, ob das Manifest eines frisch
 * veröffentlichten Releases den Kanal fortschreibt.
 *
 *   node scripts/release/desktop-kanal.mjs --neu versand/latest.json [--alt kanal/latest.json]
 *
 * Gibt `hochladen` oder `behalten` aus. Aufgerufen vom Job `desktop-kanal` in
 * `.github/workflows/artefakte.yml`; der Selbsttest (`desktop-kanal.test.mjs`) läuft in
 * Schritt 8 von `scripts/check-all.sh`.
 *
 * Der Kanal ist das Release `desktop-alpha` mit genau einer Datei `latest.json`. Hüllen mit
 * einer Vorabversion lesen es (`src-tauri/src/update.rs`), stabile Hüllen weiter
 * `releases/latest/download/latest.json`. Die URLs im Manifest zeigen auf das versionierte
 * Release, nicht auf den Kanal.
 *
 * NUR VORWÄRTS: Zwei Läufe können sich überholen (Nebenläufigkeit je Tag), und ein Nachbau
 * eines älteren Releases darf den Kanal nicht zurückdrehen. Hochgeladen wird deshalb nur, was
 * nach SemVer neuer ist als der Stand im Kanal. Stabile Releases schreiben den Kanal auch fort:
 * 1.0.0 ist neuer als jede 1.0.0-alpha.N.
 *
 * NUR VOLLSTÄNDIG: Fehlt eine Plattform, die der Kanal schon trägt, bliebe deren Hülle auf der
 * alten Version, ohne dass es jemand merkt — `behalten`, bis ein Release wieder alle trägt.
 */
import { existsSync, readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

import { vergleicheVersion } from './pr-kommentare.mjs';

const VERSION_MUSTER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/;

function pruefeManifest(manifest, wer) {
  if (!manifest || typeof manifest.version !== 'string' || !VERSION_MUSTER.test(manifest.version)) {
    throw new Error(`${wer}: keine zulässige Version im Manifest.`);
  }
  if (!manifest.platforms || Object.keys(manifest.platforms).length === 0) {
    throw new Error(`${wer}: Manifest ohne Plattform.`);
  }
}

/**
 * @param {{ neu: object, alt: object | null }} e  `alt`: das Manifest im Kanal, `null` wenn leer.
 * @returns {{ entscheidung: 'hochladen' | 'behalten', grund: string }}
 */
export function entscheide({ neu, alt }) {
  pruefeManifest(neu, 'neu');
  if (alt === null) {
    return { entscheidung: 'hochladen', grund: `Kanal leer, ${neu.version} ist der erste Stand` };
  }
  pruefeManifest(alt, 'Kanal');
  if (vergleicheVersion(`v${neu.version}`, `v${alt.version}`) <= 0) {
    return { entscheidung: 'behalten', grund: `Kanal trägt ${alt.version}, ${neu.version} ist nicht neuer` };
  }
  const fehlt = Object.keys(alt.platforms).filter((p) => !(p in neu.platforms));
  if (fehlt.length) {
    return { entscheidung: 'behalten', grund: `${neu.version} fehlt ${fehlt.join(', ')}` };
  }
  return { entscheidung: 'hochladen', grund: `${alt.version} → ${neu.version}` };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { neu: { type: 'string' }, alt: { type: 'string' } } });
  if (!values.neu) {
    console.error('Aufruf: desktop-kanal.mjs --neu <latest.json> [--alt <latest.json>]');
    process.exit(2);
  }
  const lies = (pfad) => JSON.parse(readFileSync(pfad, 'utf8'));
  const alt = values.alt && existsSync(values.alt) ? lies(values.alt) : null;
  const { entscheidung, grund } = entscheide({ neu: lies(values.neu), alt });
  console.error(`Alpha-Kanal: ${grund}`);
  console.log(entscheidung);
}
