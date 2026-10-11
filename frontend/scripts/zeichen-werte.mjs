// Werteliste der Zeichenbeschreibung für den Server (LFH-836, design.md D3).
//
// Das Rust-Backend kennt `@einsatzzeichen` nicht. Es prüft eine gesendete `zeichen_spec` gegen
// `src/freies_zeichen/zeichen_werte.json`, die dieses Skript aus der installierten Bibliothek
// erzeugt: die Arten (`spec` mit `SymbolKind`, `freestanding` je `FreestandingKind`), je Art die
// Felder und je Feld seine Form und seinen Wertevorrat (`SPEC_FIELD_VALUES`,
// `FREESTANDING_FIELD_VALUES`). Pflichtfelder und Mindestlängen der Listen fragt das Skript beim
// Leser der Bibliothek (`parseAnySpec`) ab, statt sie abzuschreiben.
//
// Formen im JSON:
//   wert      genau ein Wert aus `werte`
//   liste     Liste aus `werte`, mindestens `min` Einträge; Dubletten lehnt der Server ab
//   schalter  nur `true` (sonst das Feld weglassen)
//   fassungen Objekt: Schlüssel aus `schluessel`, Werte aus `werte` (`bodyMarkRenditions`)
//   verlauf   nur der Form nach: `points` (≥ 2 Stützpunkte) oder `start`/`directionDeg`/`lengthMm`
//   flaeche   nur der Form nach: `width` und `height` größer als null (`canvasMm`)
//   verboten  vom Hub gesperrt, mit `grund` — Bezeichnung und Beschriftung stehen in `label`
//
// Neu erzeugen: `mise exec -- pnpm -C frontend zeichen-werte`. Der Wächter
// `src/zeichen/zeichenWerte.guard.test.ts` vergleicht die eingecheckte Datei mit dieser Ausgabe;
// ein Bibliotheksupgrade ohne Neuerzeugung wird dort rot. Ein neues strukturiertes Feld der
// Bibliothek bricht dieses Skript ab, bis hier entschieden ist, wie der Server es prüft.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FREESTANDING_FIELD_VALUES,
  LIST_SPEC_FIELDS,
  SPEC_FIELD_VALUES,
  SPEC_FORMAT_VERSION,
  parseAnySpec,
} from '@einsatzzeichen/core';
import { BODY_MARK_RENDITION_IDS, FREESTANDING_KINDS } from '@einsatzzeichen/schema';
import { format, resolveConfig } from 'prettier';

const frontend = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Die erzeugte Datei, relativ zu diesem Skript aufgelöst. */
export const ZIEL = join(frontend, '..', 'src', 'freies_zeichen', 'zeichen_werte.json');

const sortiert = (werte) => [...werte].sort();

const BEZEICHNUNG_GESPERRT = {
  form: 'verboten',
  grund:
    'Die Bezeichnung steht im Feld „label“ des freien Zeichens, nicht in der Zeichenbeschreibung.',
};

/**
 * Felder ohne aufzählbaren Vorrat (`structured`, `text`): wie der Server sie prüft, und ein
 * gültiger Probewert für die Abfrage der Pflichtfelder.
 */
const STRUKTURIERT = {
  spec: {
    bodyMarkRenditions: {
      eintrag: () => ({
        form: 'fassungen',
        schluessel: sortiert(SPEC_FIELD_VALUES.bodyMarks.values),
        werte: sortiert(BODY_MARK_RENDITION_IDS),
      }),
      probe: {},
    },
    designation: { eintrag: () => BEZEICHNUNG_GESPERRT, probe: 'X' },
    labels: { eintrag: () => BEZEICHNUNG_GESPERRT, probe: {} },
  },
  freestanding: {
    path: {
      eintrag: () => ({ form: 'verlauf' }),
      probe: {
        points: [
          [0, 0],
          [10, 0],
        ],
      },
    },
    canvasMm: { eintrag: () => ({ form: 'flaeche' }), probe: { width: 10, height: 10 } },
  },
};

function strukturiert(huelle, feld) {
  const eintrag = STRUKTURIERT[huelle][feld];
  if (!eintrag) {
    throw new Error(
      `Unbekanntes strukturiertes Feld „${feld}“ (${huelle}): erst in scripts/zeichen-werte.mjs ` +
        'und im Rust-Prüfer festlegen, wie der Server es prüft.',
    );
  }
  return eintrag;
}

function probewert(huelle, feld, domaene) {
  switch (domaene.shape) {
    case 'one-of':
      return domaene.values[0];
    case 'list':
      return [domaene.values[0]];
    case 'flag':
      return true;
    default:
      return strukturiert(huelle, feld).probe;
  }
}

function lies(huelle, objekt) {
  parseAnySpec({ v: SPEC_FORMAT_VERSION, [huelle]: objekt });
}

/** Pflichtfelder einer Art: so lange lesen, bis der Leser kein fehlendes Pflichtfeld mehr nennt. */
function pflichtfelder(huelle, tabelle) {
  const objekt = {};
  const pflicht = [];
  for (let runde = 0; runde <= Object.keys(tabelle).length; runde += 1) {
    try {
      lies(huelle, objekt);
      return { pflicht: sortiert(pflicht), minimal: objekt };
    } catch (fehler) {
      const treffer = /^Pflichtfeld „([^“]+)“ fehlt/.exec(fehler.reason ?? '');
      if (!treffer || !(treffer[1] in tabelle)) {
        throw new Error(`Pflichtfelder (${huelle}) nicht ermittelbar: ${fehler.message}`, {
          cause: fehler,
        });
      }
      pflicht.push(treffer[1]);
      objekt[treffer[1]] = probewert(huelle, treffer[1], tabelle[treffer[1]]);
    }
  }
  throw new Error(`Pflichtfelder (${huelle}) nicht ermittelbar: keine Ruhe nach allen Feldern.`);
}

function liestOhneFehler(huelle, objekt) {
  try {
    lies(huelle, objekt);
    return true;
  } catch {
    return false;
  }
}

function art(huelle, tabelle, listenfelder) {
  const { pflicht, minimal } = pflichtfelder(huelle, tabelle);
  const felder = {};
  for (const feld of sortiert(Object.keys(tabelle))) {
    const domaene = tabelle[feld];
    let eintrag;
    if (domaene.shape === 'one-of') {
      eintrag = { form: 'wert', werte: sortiert(domaene.values) };
    } else if (domaene.shape === 'list') {
      if (!listenfelder.has(feld)) {
        throw new Error(`Listenfeld „${feld}“ (${huelle}) fehlt in der Liste der Listenfelder.`);
      }
      const leerErlaubt = liestOhneFehler(huelle, { ...minimal, [feld]: [] });
      eintrag = { form: 'liste', min: leerErlaubt ? 0 : 1, werte: sortiert(domaene.values) };
    } else if (domaene.shape === 'flag') {
      eintrag = { form: 'schalter' };
    } else {
      eintrag = strukturiert(huelle, feld).eintrag();
    }
    // Was der Hub nicht sperrt, muss der Leser der Bibliothek mit dem Probewert annehmen —
    // sonst passt die Tabelle nicht zum Codec.
    if (eintrag.form !== 'verboten') {
      const probe = { ...minimal, [feld]: probewert(huelle, feld, domaene) };
      if (!liestOhneFehler(huelle, probe)) {
        throw new Error(`Feld „${feld}“ (${huelle}) liest die Bibliothek mit dem Probewert nicht.`);
      }
    }
    felder[feld] = eintrag;
  }
  return { felder, pflicht };
}

function bibliotheksversion() {
  const paket = join(frontend, 'node_modules', '@einsatzzeichen', 'core', 'package.json');
  return JSON.parse(readFileSync(paket, 'utf8')).version;
}

/** Erzeugt den Inhalt von `ZIEL`, formatiert wie Prettier im Frontend. */
export async function erzeugeZeichenWerte() {
  const freestanding = {};
  for (const kind of sortiert(FREESTANDING_KINDS)) {
    const tabelle = FREESTANDING_FIELD_VALUES[kind];
    const listen = Object.keys(tabelle).filter((feld) => tabelle[feld].shape === 'list');
    freestanding[kind] = art('freestanding', tabelle, new Set(listen));
  }
  const daten = {
    _erzeugt:
      'frontend/scripts/zeichen-werte.mjs aus @einsatzzeichen (LFH-836) — nicht von Hand ändern, ' +
      'neu erzeugen mit: mise exec -- pnpm -C frontend zeichen-werte',
    bibliothek: bibliotheksversion(),
    formatVersion: SPEC_FORMAT_VERSION,
    freestanding,
    spec: art('spec', SPEC_FIELD_VALUES, new Set(LIST_SPEC_FIELDS)),
  };
  const optionen = (await resolveConfig(ZIEL)) ?? (await resolveConfig(join(frontend, 'x.json')));
  return format(JSON.stringify(daten), { ...optionen, parser: 'json' });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  writeFileSync(ZIEL, await erzeugeZeichenWerte());
  console.log(`geschrieben: ${ZIEL}`);
}
