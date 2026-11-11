#!/usr/bin/env node
/**
 * Vorabkanäle der Desktop-Hülle (LLH-1280 Alpha, LLH-1545 Beta): welche Kanäle ein frisch
 * veröffentlichtes Release fortschreibt, und ob sein Manifest den jeweiligen Kanal ersetzt.
 *
 *   node scripts/release/desktop-kanal.mjs --kanaele-fuer 1.0.0-beta.2
 *   node scripts/release/desktop-kanal.mjs --kanal desktop-beta --neu versand/latest.json \
 *     [--alt kanal/latest.json]
 *
 * Die erste Form gibt die Kanäle aus, je einer pro Zeile (keine Zeile: kein Kanal). Die zweite
 * gibt `hochladen` oder `behalten` aus. Aufgerufen vom Job `desktop-kanal` in
 * `.github/workflows/artefakte.yml`; der Selbsttest (`desktop-kanal.test.mjs`) läuft in
 * Schritt 8 von `scripts/check-all.sh`.
 *
 * Ein Kanal ist ein Release (`desktop-alpha`, `desktop-beta`) mit genau einer Datei
 * `latest.json`. Hüllen lesen ihn nach ihrem Kanal (`src-tauri/src/kanal.rs`, `update.rs`),
 * stabile Hüllen weiter `releases/latest/download/latest.json`. Die URLs im Manifest zeigen auf
 * das versionierte Release, nicht auf den Kanal.
 *
 * JEDER VORABKANAL NUR SEINE EIGENEN: Alpha und Beta zählen parallel (`1.0.0-alpha.180` neben
 * `1.0.0-beta.3`, LLH-1545), und nach SemVer ist jede Beta „neuer“ als jede Alpha desselben
 * Kerns. Schriebe eine Beta in den Alpha-Kanal, sprängen alle Alpha-Hüllen auf sie, und jede
 * weitere Alpha würde danach als „nicht neuer“ verworfen. Stabile Releases schreiben beide
 * Kanäle fort: 1.0.0 ist neuer als jede 1.0.0-alpha.N und 1.0.0-beta.N.
 *
 * NUR VORWÄRTS: Zwei Läufe können sich überholen (Nebenläufigkeit je Tag), und ein Nachbau
 * eines älteren Releases darf den Kanal nicht zurückdrehen. Hochgeladen wird deshalb nur, was
 * nach SemVer neuer ist als der Stand im Kanal.
 *
 * NUR VOLLSTÄNDIG: Fehlt eine Plattform, die der Kanal schon trägt, bliebe deren Hülle auf der
 * alten Version, ohne dass es jemand merkt — `behalten`, bis ein Release wieder alle trägt.
 */
import { existsSync, readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

import { kanalVon, vergleicheVersion } from './pr-kommentare.mjs';

const VERSION_MUSTER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/;

/** Vorabkennung → Release, das den Kanal trägt. */
export const KANAELE = { alpha: 'desktop-alpha', beta: 'desktop-beta' };

/**
 * Die Kanäle, die ein Release dieser Version fortschreibt: eine Alpha den Alpha-, eine Beta den
 * Beta-Kanal, ein stabiles Release beide. Eine andere Vorabkennung (etwa `rc`) keinen.
 * @param {string} version  ohne `v`, z. B. `1.0.0-beta.2`
 * @returns {string[]}
 */
export function kanaeleFuer(version) {
  if (typeof version !== 'string' || !VERSION_MUSTER.test(version)) {
    throw new Error(`Keine zulässige Version: '${version}'.`);
  }
  const vorab = kanalVon(`v${version}`);
  if (vorab === null) return Object.values(KANAELE);
  return KANAELE[vorab] ? [KANAELE[vorab]] : [];
}

function pruefeManifest(manifest, wer) {
  if (!manifest || typeof manifest.version !== 'string' || !VERSION_MUSTER.test(manifest.version)) {
    throw new Error(`${wer}: keine zulässige Version im Manifest.`);
  }
  if (!manifest.platforms || Object.keys(manifest.platforms).length === 0) {
    throw new Error(`${wer}: Manifest ohne Plattform.`);
  }
}

/**
 * @param {{ kanal: string, neu: object, alt: object | null }} e  `kanal`: Release des Kanals
 *   (`desktop-alpha`, `desktop-beta`); `alt`: das Manifest im Kanal, `null` wenn leer.
 * @returns {{ entscheidung: 'hochladen' | 'behalten', grund: string }}
 */
export function entscheide({ kanal, neu, alt }) {
  if (!Object.values(KANAELE).includes(kanal)) {
    throw new Error(`Unbekannter Kanal: '${kanal}'.`);
  }
  pruefeManifest(neu, 'neu');
  if (!kanaeleFuer(neu.version).includes(kanal)) {
    return { entscheidung: 'behalten', grund: `${neu.version} gehört nicht in ${kanal}` };
  }
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
  const { values } = parseArgs({
    options: {
      'kanaele-fuer': { type: 'string' },
      kanal: { type: 'string' },
      neu: { type: 'string' },
      alt: { type: 'string' },
    },
  });
  if (values['kanaele-fuer'] !== undefined) {
    for (const kanal of kanaeleFuer(values['kanaele-fuer'])) console.log(kanal);
    process.exit(0);
  }
  if (!values.neu || !values.kanal) {
    console.error(
      'Aufruf: desktop-kanal.mjs --kanaele-fuer <version>\n' +
        '        desktop-kanal.mjs --kanal <desktop-alpha|desktop-beta> --neu <latest.json> [--alt <latest.json>]',
    );
    process.exit(2);
  }
  const lies = (pfad) => JSON.parse(readFileSync(pfad, 'utf8'));
  const alt = values.alt && existsSync(values.alt) ? lies(values.alt) : null;
  const { entscheidung, grund } = entscheide({ kanal: values.kanal, neu: lies(values.neu), alt });
  console.error(`${values.kanal}: ${grund}`);
  console.log(entscheidung);
}
