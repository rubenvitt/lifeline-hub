#!/usr/bin/env node
// LFH-595: Die Icons der App aus ihren Quellen erzeugen.
//
//   mise exec -- node scripts/icons/erzeuge-icons.mjs
//
// Quellen (alle eingecheckt, Spec `iconsatz`):
//   icons.json                    Register: Name, Bedeutung, Icons8-Kennung, Herkunft
//   quellen/<name>.svg             Icons8 „iOS 27 Outlined“ (herkunft icons8/ersatz) oder eigene
//                                  Zeichnung im selben Raster (herkunft eigen, Vermerk im Kopf)
//   quellen/<name>.gefuellt.svg    Zwilling aus „iOS 27 Filled“, nur wenn `gefuellt` gesetzt ist
//
// Ausgabe:
//   frontend/src/icons/erzeugt.generated.ts   eine Komponente je Quelle (Prettier-formatiert)
//   scripts/icons/quellen.sha256               Stempel über Register, Quellen und Ausgabe
//
// Neue Icons holt der Agent über den Icons8-MCP (Konto mit Abo) als SVG nach `quellen/`; das
// Skript selbst geht nicht ins Netz. `frontend/src/icons/icons.guard.test.ts` prüft Stempel,
// Vollständigkeit und dass jedes Icon verwendet wird.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const hier = dirname(fileURLToPath(import.meta.url));
const wurzel = join(hier, '..', '..');
const frontend = join(wurzel, 'frontend');
const ausgabe = join(frontend, 'src', 'icons', 'erzeugt.generated.ts');
const quellen = join(hier, 'quellen');
const register = join(hier, 'icons.json');
const stempel = join(hier, 'quellen.sha256');

export const EIGEN_VERMERK = '<!-- eigene Zeichnung (LFH-595) im Raster von iOS 27 Outlined -->';
const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function fehler(meldung) {
  console.error(`erzeuge-icons: ${meldung}`);
  process.exit(1);
}

/** `pfeil-links` → `PfeilLinks`. */
export function pascal(name) {
  return name
    .split('-')
    .map((teil) => teil[0].toUpperCase() + teil.slice(1))
    .join('');
}

/**
 * Liest viewBox und Pfade. Zugelassen sind nach dem `<svg>`-Kopf nur `<path d fill-rule>`,
 * `</path>`, Kommentare und Leerraum; alles andere ist ein Fehler. Bewusst ein Leser über die
 * Zeichen statt eines Regex-Filters: Die Quelle wird nicht bereinigt, sondern abgelehnt, wenn
 * sie etwas enthält, das nicht in dieses enge Raster passt.
 */
export function zerlegeSvg(svg, datei) {
  const kopfStart = svg.indexOf('<svg');
  const kopfEnde = kopfStart === -1 ? -1 : svg.indexOf('>', kopfStart);
  if (kopfEnde === -1) throw new Error(`${datei}: kein <svg>`);
  const viewBox = svg.slice(kopfStart, kopfEnde).match(/viewBox="([^"]+)"/)?.[1];
  if (!viewBox) throw new Error(`${datei}: <svg> ohne viewBox`);
  const pfade = [];
  let i = kopfEnde + 1;
  for (;;) {
    while (i < svg.length && /\s/.test(svg[i])) i++;
    if (i >= svg.length) throw new Error(`${datei}: </svg> fehlt`);
    if (svg.startsWith('</svg>', i)) break;
    if (svg.startsWith('<!--', i)) {
      const schluss = svg.indexOf('-->', i + 4);
      if (schluss === -1) throw new Error(`${datei}: Kommentar ohne Ende`);
      i = schluss + 3;
      continue;
    }
    if (svg.startsWith('</path>', i)) {
      i += '</path>'.length;
      continue;
    }
    if (svg.startsWith('<path', i) && /[\s/>]/.test(svg[i + 5] ?? '')) {
      const schluss = svg.indexOf('>', i);
      if (schluss === -1) throw new Error(`${datei}: <path> ohne Ende`);
      const attribute = svg.slice(i + 5, schluss).replace(/\/$/, '');
      const namen = [...attribute.matchAll(/([a-zA-Z:-]+)=/g)].map((m) => m[1]);
      const unbekannt = namen.filter((a) => a !== 'd' && a !== 'fill-rule');
      if (unbekannt.length) throw new Error(`${datei}: Pfad mit ${unbekannt.join(', ')}`);
      const d = attribute.match(/\bd="([^"]+)"/)?.[1];
      if (!d) throw new Error(`${datei}: Pfad ohne d`);
      const fillRule = attribute.match(/fill-rule="(evenodd|nonzero)"/)?.[1];
      pfade.push(fillRule ? { d, fillRule } : { d });
      i = schluss + 1;
      continue;
    }
    throw new Error(`${datei}: nicht unterstützter Inhalt: ${svg.slice(i, i + 80)}`);
  }
  if (!pfade.length) throw new Error(`${datei}: keine Pfade`);
  return { viewBox, pfade };
}

/** JS-Literal über `JSON.stringify` (vollständig maskiert); Prettier setzt danach die Anführung. */
function literal(wert) {
  return JSON.stringify(wert);
}

function komponente(exportName, name, quelle, kommentar) {
  const pfade = quelle.pfade
    .map((p) => `{ d: ${literal(p.d)}${p.fillRule ? `, fillRule: '${p.fillRule}'` : ''} }`)
    .join(', ');
  return `/** ${kommentar} */\nexport const ${exportName} = icon(${literal(name)}, ${literal(quelle.viewBox)}, [${pfade}]);\n`;
}

export function erzeugeModul(eintraege, lies) {
  const teile = [
    '// ERZEUGT von scripts/icons/erzeuge-icons.mjs aus scripts/icons/ (LFH-595).',
    '// Nicht von Hand ändern: Quellen und Register dort, dann das Skript laufen lassen.',
    "import { icon } from './IconRahmen';",
    '',
  ];
  for (const e of eintraege) {
    const herkunft =
      e.herkunft === 'eigen'
        ? 'eigene Zeichnung'
        : `Icons8 „${e.icons8.commonName}“ (${e.icons8.id})${e.herkunft === 'ersatz' ? ', Ersatz' : ''}`;
    const umriss = zerlegeSvg(lies(`${e.name}.svg`), `${e.name}.svg`);
    if (e.herkunft === 'eigen' && !lies(`${e.name}.svg`).includes(EIGEN_VERMERK)) {
      throw new Error(`${e.name}.svg: eigene Zeichnung ohne Vermerk`);
    }
    teile.push(komponente(`Icon${pascal(e.name)}`, e.name, umriss, `${e.bedeutung} · ${herkunft}`));
    if (e.gefuellt) {
      const voll = zerlegeSvg(lies(`${e.name}.gefuellt.svg`), `${e.name}.gefuellt.svg`);
      teile.push(
        komponente(
          `Icon${pascal(e.name)}Gefuellt`,
          `${e.name}.gefuellt`,
          voll,
          `${e.bedeutung}, aktiv · Icons8 „${e.gefuellt.commonName}“ (${e.gefuellt.id})`,
        ),
      );
    }
  }
  return teile.join('\n');
}

export function pruefeRegister(daten, vorhandeneDateien) {
  if (!daten || !Array.isArray(daten.icons)) throw new Error('icons.json: Feld `icons` fehlt');
  const namen = new Set();
  for (const e of daten.icons) {
    if (!NAME.test(e.name ?? '')) throw new Error(`Name ungültig: ${JSON.stringify(e.name)}`);
    if (namen.has(e.name)) throw new Error(`Name doppelt: ${e.name}`);
    namen.add(e.name);
    if (!['icons8', 'ersatz', 'eigen'].includes(e.herkunft)) {
      throw new Error(`${e.name}: herkunft muss icons8, ersatz oder eigen sein`);
    }
    if (e.herkunft !== 'eigen' && !e.icons8?.id) throw new Error(`${e.name}: icons8.id fehlt`);
    if (!e.bedeutung) throw new Error(`${e.name}: bedeutung fehlt`);
  }
  const erwartet = new Set(
    daten.icons.flatMap((e) => [`${e.name}.svg`, ...(e.gefuellt ? [`${e.name}.gefuellt.svg`] : [])]),
  );
  for (const d of erwartet) if (!vorhandeneDateien.includes(d)) throw new Error(`Quelle fehlt: ${d}`);
  for (const d of vorhandeneDateien) if (!erwartet.has(d)) throw new Error(`Quelle ohne Eintrag: ${d}`);
}

async function main() {
  const daten = JSON.parse(readFileSync(register, 'utf8'));
  const dateien = readdirSync(quellen).filter((d) => d.endsWith('.svg'));
  try {
    pruefeRegister(daten, dateien);
  } catch (e) {
    fehler(e.message);
  }
  const eintraege = [...daten.icons].sort((a, b) => a.name.localeCompare(b.name));
  let modul;
  try {
    modul = erzeugeModul(eintraege, (datei) => readFileSync(join(quellen, datei), 'utf8'));
  } catch (e) {
    fehler(e.message);
  }
  const prettier = createRequire(join(frontend, 'package.json'))('prettier');
  const optionen = (await prettier.resolveConfig(ausgabe)) ?? {};
  writeFileSync(ausgabe, await prettier.format(modul, { ...optionen, filepath: ausgabe }));

  const gestempelt = [register, ...dateien.sort().map((d) => join(quellen, d)), ausgabe];
  const zeilen = gestempelt.map((pfad) => {
    const summe = createHash('sha256').update(readFileSync(pfad)).digest('hex');
    return `${summe}  ${relative(wurzel, pfad)}`;
  });
  writeFileSync(stempel, `${zeilen.join('\n')}\n`);
  console.log(`erzeuge-icons: ${eintraege.length} Einträge, ${dateien.length} Quellen`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
