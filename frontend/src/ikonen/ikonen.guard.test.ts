/**
 * Ikonen-Guard (LFH-595, Spec `ikonensatz`): EIN Ikonensatz, EIN Importort, keine Emojis.
 *
 * ── Drei Prüfungen ─────────────────────────────────────────────────────────────
 *  1. Kein Fremdimport: außerhalb von `ikonen/` importiert keine Datei aus `@ant-design/icons`
 *     oder `react-icons`. Der Bestand steht in der Schuldmenge {@link OFFEN}; sie schrumpft nur.
 *     Ein Eintrag ohne Fund ist eine tote Ausnahme und macht den Guard rot.
 *  2. Register, Quellen, Ausgabe und Stempel stimmen überein (`scripts/ikonen/`): jede Datei im
 *     Stempel hat ihre Summe, jede Quelle steht im Stempel, jede Ikone wird außerhalb von
 *     `ikonen/` und außerhalb von Tests verwendet, eigene Zeichnungen tragen ihren Vermerk.
 *  3. Kein Emoji als Ikone: `\p{Extended_Pictographic}` im Code (ohne Kommentare, ohne Tests).
 *     Erlaubt sind die Textzeichen in {@link ERLAUBTE_ZEICHEN}; der Bestand steht in
 *     {@link OFFEN_EMOJI}.
 *
 * ── Warum ein Vitest-Guard und keine ESLint-Regel ───────────────────────────────
 * `pnpm lint` läuft mit `--max-warnings 0`; eine rot geborene Regel würde abgeschaltet. Die
 * Schuldmenge hält den Bestand sichtbar, bis er abgetragen ist (Muster `dichte.guard.test.ts`).
 * Danach sperrt zusätzlich pnpm den Import, weil beide Pakete aus `package.json` fallen.
 *
 * ── Was dieser Guard NICHT sieht ────────────────────────────────────────────────
 *  • einen Import über einen Umweg (eigenes Re-Export-Modul außerhalb von `ikonen/`, `require`
 *    mit berechnetem Namen);
 *  • ein Emoji hinter `//` in einer Zeichenkette oder in JSX-Text (`"https://…"`): der
 *    Kommentarschnitt ist zeilenbasiert und kennt keine Zeichenketten;
 *  • Ikonen, die antd in seinen eigenen Bauteilen zeichnet (Auswahlpfeil, Schließkreuz,
 *    Sortierpfeile, Spinner von `loading`) — die nimmt die Spec ausdrücklich aus;
 *  • ob eine Ikone zu ihrer Bedeutung passt (das prüft die Zuordnungstabelle der Change).
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');
const WURZEL = join(SRC, '..', '..');
const SKRIPTE = join(WURZEL, 'scripts', 'ikonen');
const QUELLEN = join(SKRIPTE, 'quellen');
const AUSGABE = join(SRC, 'ikonen', 'erzeugt.generated.ts');

/** Muss mit `EIGEN_VERMERK` in `scripts/ikonen/erzeuge-ikonen.mjs` übereinstimmen. */
const EIGEN_VERMERK = '<!-- eigene Zeichnung (LFH-595) im Raster von iOS 27 Outlined -->';

/**
 * SCHULDMENGE: Dateien, die noch aus `@ant-design/icons` oder `react-icons` importieren. Leer seit
 * 30.09.2026 (LFH-595 abgeschlossen); bleibt als Stelle für eine begründete Ausnahme stehen.
 */
const OFFEN = new Set<string>([]);

/** Textzeichen, die keine Ikone vertreten (Spec „Ein Emoji ist keine Ikone“). */
const ERLAUBTE_ZEICHEN = new Set(['↗', '↔', '©']);

/** SCHULDMENGE Emojis: Dateien, die noch ein Emoji als Ikone zeigen. Leer seit 30.09.2026. */
const OFFEN_EMOJI = new Set<string>([]);

const FREMDIMPORT =
  /(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"](?:@ant-design\/icons|react-icons)(?:\/[^'"]*)?['"]/;

function dateien(verzeichnis: string): string[] {
  return readdirSync(verzeichnis).flatMap((name) => {
    const pfad = join(verzeichnis, name);
    if (statSync(pfad).isDirectory()) return dateien(pfad);
    return /\.(ts|tsx)$/.test(name) ? [pfad] : [];
  });
}

const ALLE = dateien(SRC).map((pfad) => ({
  rel: relative(SRC, pfad).split('\\').join('/'),
  inhalt: readFileSync(pfad, 'utf8'),
}));

const istTest = (rel: string) => /\.test\.[jt]sx?$/.test(rel);
const imIkonenOrdner = (rel: string) => rel.startsWith('ikonen/');

/** Zeilenbasierter Kommentarschnitt wie in `dichte.guard.test.ts`. */
function ohneKommentare(inhalt: string): string {
  const zeilen: string[] = [];
  let imBlock = false;
  for (const roh of inhalt.split('\n')) {
    let rest = roh;
    let sichtbar = '';
    while (rest.length > 0) {
      if (imBlock) {
        const ende = rest.indexOf('*/');
        if (ende === -1) break;
        imBlock = false;
        rest = rest.slice(ende + 2);
        continue;
      }
      const block = rest.indexOf('/*');
      const einzeilig = rest.indexOf('//');
      if (block === -1 && einzeilig === -1) {
        sichtbar += rest;
        break;
      }
      if (einzeilig !== -1 && (block === -1 || einzeilig < block)) {
        sichtbar += rest.slice(0, einzeilig);
        break;
      }
      sichtbar += rest.slice(0, block);
      rest = rest.slice(block + 2);
      imBlock = true;
    }
    zeilen.push(sichtbar);
  }
  return zeilen.join('\n');
}

/** Emojis im sichtbaren Code (ohne Kommentare), ohne die erlaubten Textzeichen. */
export function emojisIn(inhalt: string): string[] {
  const funde = ohneKommentare(inhalt).match(/\p{Extended_Pictographic}/gu) ?? [];
  return [...new Set(funde)].filter((z) => !ERLAUBTE_ZEICHEN.has(z));
}

interface Registereintrag {
  name: string;
  herkunft: 'icons8' | 'ersatz' | 'eigen';
  gefuellt?: unknown;
}

function pascal(name: string): string {
  return name
    .split('-')
    .map((teil) => teil[0].toUpperCase() + teil.slice(1))
    .join('');
}

describe('Ikonen-Guard — ein Satz, ein Importort (LFH-595)', () => {
  it('kein Fremdimport außerhalb von ikonen/ — außer der Schuldmenge', () => {
    const funde = ALLE.filter((d) => !imIkonenOrdner(d.rel) && FREMDIMPORT.test(d.inhalt)).map(
      (d) => d.rel,
    );
    const neu = funde.filter((rel) => !OFFEN.has(rel));
    expect(
      neu,
      'neuer Import aus @ant-design/icons/react-icons — über ikonen/ importieren',
    ).toEqual([]);
  });

  it('die Schuldmenge enthält keine tote Ausnahme', () => {
    const mitFund = new Set(ALLE.filter((d) => FREMDIMPORT.test(d.inhalt)).map((d) => d.rel));
    const tot = [...OFFEN].filter((rel) => !mitFund.has(rel));
    expect(tot, 'Datei ist umgestellt — Eintrag aus OFFEN streichen').toEqual([]);
  });

  it('der Musterscanner erkennt Fremdimporte und lässt eigene durch (Gegenprobe)', () => {
    expect(FREMDIMPORT.test("import { PlusOutlined } from '@ant-design/icons';")).toBe(true);
    expect(FREMDIMPORT.test("import { TbX } from 'react-icons/tb';")).toBe(true);
    expect(FREMDIMPORT.test("import type { IconType } from 'react-icons';")).toBe(true);
    expect(FREMDIMPORT.test("const m = await import('react-icons/fi');")).toBe(true);
    expect(FREMDIMPORT.test("import { IkonePlus } from '../ikonen';")).toBe(false);
  });
});

describe('Ikonen-Guard — Register, Quellen, Ausgabe, Stempel (scripts/ikonen)', () => {
  const register = JSON.parse(readFileSync(join(SKRIPTE, 'ikonen.json'), 'utf8')) as {
    ikonen: Registereintrag[];
  };
  const ausgabe = readFileSync(AUSGABE, 'utf8');

  it('jede gestempelte Datei hat noch ihre Summe, und alles Nötige ist gestempelt', () => {
    const zeilen = readFileSync(join(SKRIPTE, 'quellen.sha256'), 'utf8').trim().split('\n');
    const gestempelt = new Map(
      zeilen.map((z) => {
        const [summe, pfad] = z.split(/\s+/);
        return [pfad, summe];
      }),
    );
    const erwartet = [
      'scripts/ikonen/ikonen.json',
      ...readdirSync(QUELLEN)
        .filter((d) => d.endsWith('.svg'))
        .map((d) => `scripts/ikonen/quellen/${d}`),
      'frontend/src/ikonen/erzeugt.generated.ts',
    ];
    expect([...gestempelt.keys()].sort(), 'Skript laufen lassen').toEqual([...erwartet].sort());
    for (const pfad of erwartet) {
      const summe = createHash('sha256')
        .update(readFileSync(join(WURZEL, pfad)))
        .digest('hex');
      expect(summe, `${pfad} seit dem letzten Lauf geändert — erzeuge-ikonen.mjs`).toBe(
        gestempelt.get(pfad),
      );
    }
  });

  it('jeder Eintrag hat seine Komponente, und es gibt keine ohne Eintrag', () => {
    const erwartet = register.ikonen.flatMap((e) => [
      `Ikone${pascal(e.name)}`,
      ...(e.gefuellt ? [`Ikone${pascal(e.name)}Gefuellt`] : []),
    ]);
    const vorhanden = [...ausgabe.matchAll(/export const (Ikone\w+)/g)].map((m) => m[1]);
    expect([...vorhanden].sort()).toEqual([...erwartet].sort());
  });

  it('jede Ikone wird außerhalb von ikonen/ und außerhalb von Tests verwendet', () => {
    const code = ALLE.filter((d) => !imIkonenOrdner(d.rel) && !istTest(d.rel))
      .map((d) => d.inhalt)
      .join('\n');
    const namen = [...ausgabe.matchAll(/export const (Ikone\w+)/g)].map((m) => m[1]);
    const tot = namen.filter((n) => !new RegExp(`\\b${n}\\b`).test(code));
    expect(tot, 'Ikone ohne Verwendung — aus dem Register streichen').toEqual([]);
  });

  it('eigene Zeichnungen tragen ihren Vermerk, Icons8-Quellen nicht', () => {
    for (const e of register.ikonen) {
      const quelle = join(QUELLEN, `${e.name}.svg`);
      expect(existsSync(quelle), `Quelle fehlt: ${e.name}.svg`).toBe(true);
      const hatVermerk = readFileSync(quelle, 'utf8').includes(EIGEN_VERMERK);
      expect(hatVermerk, `${e.name}: Vermerk passt nicht zur Herkunft ${e.herkunft}`).toBe(
        e.herkunft === 'eigen',
      );
    }
  });
});

describe('Ikonen-Guard — ein Emoji ist keine Ikone', () => {
  it('kein Emoji im Code außerhalb der Schuldmenge', () => {
    const funde = ALLE.filter((d) => !istTest(d.rel) && emojisIn(d.inhalt).length > 0);
    const neu = funde
      .filter((d) => !OFFEN_EMOJI.has(d.rel))
      .map((d) => `${d.rel}: ${emojisIn(d.inhalt).join(' ')}`);
    expect(neu, 'Emoji als Ikone — eine Ikone des Satzes nehmen').toEqual([]);
  });

  it('die Emoji-Schuldmenge enthält keine tote Ausnahme', () => {
    const mitFund = new Set(ALLE.filter((d) => emojisIn(d.inhalt).length > 0).map((d) => d.rel));
    expect([...OFFEN_EMOJI].filter((rel) => !mitFund.has(rel))).toEqual([]);
  });

  it('der Scanner sieht Emojis im Code, nicht in Kommentaren, und lässt Textzeichen durch', () => {
    expect(emojisIn("const t = '⛈️ Gewitter';")).toEqual(['⛈']);
    expect(emojisIn('// ⛈ nur im Kommentar')).toEqual([]);
    expect(emojisIn('/* 🚧 */ const x = 1;')).toEqual([]);
    expect(emojisIn("const s = 'Deeplink ↗ © OSM ✓ ⧖';")).toEqual([]);
  });
});
