/**
 * Vorgabe-Guard (LFH-944, Spec `bedien-begriffe`): ein voreingestellter Wert heißt im sichtbaren
 * Text „Vorgabe“. „Default“ und „Fallback“ stehen dort nie, „Standard“ nicht in dieser Bedeutung.
 *
 * ── Warum ──────────────────────────────────────────────────────────────────────
 * Vor der Regel standen drei Wörter für dieselbe Sache nebeneinander („Europe/Berlin (Fallback)“
 * in der Verwaltung, „Europe/Berlin (Standard)“ im Einsatz). Wer Vorgaben vor einer Großlage
 * einrichtet, konnte nicht sagen, ob ein leeres Feld unbedenklich ist. Der Wortlaut steht in
 * `vorgabeText.ts`; dieser Guard fängt einen neuen oder zurückgemergten Altwortlaut.
 *
 * ── Warum groß geschrieben und als ganzes Wort ─────────────────────────────────
 * So trifft das Muster Text, nicht Bezeichner: `preventDefault`, `DefaultOptionType`,
 * `fehlerFallback`, `DEFAULT_KONVENTIONEN`, `EinsatzDefaults` haben keine Wortgrenze vor oder
 * hinter dem Wort oder sind anders geschrieben. „Standardansicht“ ist ein Wort und fällt nicht
 * unter das Muster.
 *
 * ── Warum ein Vitest-Guard und keine ESLint-Regel ───────────────────────────────
 * `pnpm lint` läuft mit `--max-warnings 0`; eine rot geborene Regel würde abgeschaltet
 * (`frontend/AGENTS.md`, Lint-Disziplin). Muster: `dichte.guard.test.ts`.
 *
 * ── Was dieser Guard NICHT sieht ────────────────────────────────────────────────
 *   • Text aus anderen Quellen (Servermeldungen, Daten);
 *   • ein Wort, das zur Laufzeit zusammengesetzt wird (`'Stan' + 'dard'`);
 *   • einen Kommentar hinter einem `//`, vor dem ein Doppelpunkt steht — das gilt als URL
 *     (`https://…`) und bleibt Text.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENDUNGEN = /\.(ts|tsx)$/;
const ALTWORT = /\b(Defaults?|Fallback|Standard)\b/g;

interface Ausnahme {
  pfad: string;
  /** Teilzeichenkette der Fundzeile, die die Ausnahme belegt. */
  text: string;
  grund: string;
}

/**
 * Benannte Dinge mit eigener Spec. Ein Eintrag ohne Fund färbt den Guard rot (tote Ausnahme),
 * sonst überlebt die Liste ihren Grund.
 */
const AUSNAHMEN: readonly Ausnahme[] = [
  {
    pfad: '/src/etb/MetaChip.tsx',
    text: "label: 'Standard-Rufname ändern'",
    grund: 'Eigenname „Standard-Rufname“ (Specs etb-absender-empfaenger, fuehrungsfunktionen)',
  },
  {
    pfad: '/src/etb/MetaChip.tsx',
    text: "STANDARD_TITEL = 'Standard-Rufname:",
    grund: 'Eigenname „Standard-Rufname“ (Specs etb-absender-empfaenger, fuehrungsfunktionen)',
  },
  {
    pfad: '/src/pages/lagekarte/AnsichtSwitcher.tsx',
    text: "label: 'Als Standard'",
    grund: 'Gehört zur „Standardansicht“ der Lagekarte (Spec betreuung-lagekarte)',
  },
];

function lieseQuellen(verzeichnis: string, praefix = '/src'): Record<string, string> {
  const treffer: Record<string, string> = {};
  for (const eintrag of readdirSync(verzeichnis, { withFileTypes: true })) {
    const pfad = join(verzeichnis, eintrag.name);
    if (eintrag.isDirectory()) {
      Object.assign(treffer, lieseQuellen(pfad, `${praefix}/${eintrag.name}`));
    } else if (ENDUNGEN.test(eintrag.name)) {
      treffer[`${praefix}/${eintrag.name}`] = readFileSync(pfad, 'utf8');
    }
  }
  return treffer;
}

function istTest(pfad: string): boolean {
  return /\.test\.[jt]sx?$/.test(pfad) || /\.generated\.[jt]sx?$/.test(pfad);
}

/** Erstes `//`, das einen Kommentar beginnt; ein `//` hinter `:` gehört zu einer URL. */
function zeilenKommentar(zeile: string): number {
  let ab = 0;
  for (;;) {
    const i = zeile.indexOf('//', ab);
    if (i === -1 || i === 0 || zeile[i - 1] !== ':') return i;
    ab = i + 2;
  }
}

/** Blendet Kommentarinhalt aus, Blockzustand über Zeilengrenzen getragen. */
export function ohneKommentare(inhalt: string): string {
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
      const einzeilig = zeilenKommentar(rest);
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

interface Fund {
  pfad: string;
  zeile: number;
  wort: string;
  text: string;
}

export function fundeIn(pfad: string, quelltext: string): Fund[] {
  const funde: Fund[] = [];
  ohneKommentare(quelltext)
    .split('\n')
    .forEach((text, i) => {
      for (const m of text.matchAll(ALTWORT)) {
        funde.push({ pfad, zeile: i + 1, wort: m[1], text: text.trim() });
      }
    });
  return funde;
}

export function befunde(dateien: Record<string, string>, ausnahmen: readonly Ausnahme[]): string[] {
  const meldungen: string[] = [];
  const belegt = new Set<Ausnahme>();

  for (const [pfad, inhalt] of Object.entries(dateien)) {
    if (istTest(pfad)) continue;
    for (const f of fundeIn(pfad, inhalt)) {
      const ausnahme = ausnahmen.find((a) => a.pfad === f.pfad && f.text.includes(a.text));
      if (ausnahme) {
        belegt.add(ausnahme);
        continue;
      }
      meldungen.push(`${f.pfad}:${f.zeile}  „${f.wort}“ statt „Vorgabe“: ${f.text}`);
    }
  }

  for (const a of ausnahmen) {
    if (!belegt.has(a)) meldungen.push(`tote Ausnahme: ${a.pfad} „${a.text}“`);
  }
  return meldungen;
}

const dateien = lieseQuellen(SRC);

describe('Vorgabe-Guard (LFH-944)', () => {
  it('kein sichtbarer Text nennt einen voreingestellten Wert „Default“, „Fallback“ oder „Standard“', () => {
    expect(befunde(dateien, AUSNAHMEN)).toEqual([]);
  });

  // ── Selbstbeweise: ein Guard, der nichts findet, ist von einem kaputten nicht zu
  //    unterscheiden.

  it('findet das Altwort im Platzhalter und im Schablonen-Literal', () => {
    expect(fundeIn('/x.tsx', '<Select placeholder="24 Stunden (Fallback)" />')).toHaveLength(1);
    expect(fundeIn('/x.ts', 'return `Standard (Org): ${wert}`;')).toHaveLength(1);
    expect(fundeIn('/x.tsx', 'label="Org-Defaults"')).toHaveLength(1);
  });

  it('findet es auch hinter einer URL im selben Text', () => {
    const quelle = 'placeholder="https://nominatim.openstreetmap.org (Default)"';
    expect(fundeIn('/x.tsx', quelle)).toHaveLength(1);
  });

  it('lässt Bezeichner und zusammengesetzte Wörter in Ruhe', () => {
    const quelle = [
      'e.preventDefault();',
      'const k = DEFAULT_KONVENTIONEN;',
      'import EinsatzDefaults from "./EinsatzDefaults";',
      'const fehlerFallback = 1;',
      'type T = DefaultOptionType;',
      'const t = "Standardansicht";',
    ].join('\n');
    expect(fundeIn('/x.tsx', quelle)).toEqual([]);
  });

  it('übersieht das Altwort im Kommentar', () => {
    const quelle = ['// Default aus dem Code', '/* Fallback', '   Standard */ const a = 1;'].join(
      '\n',
    );
    expect(fundeIn('/x.ts', quelle)).toEqual([]);
  });

  it('meldet eine Ausnahme ohne Fund als tot', () => {
    const tot: Ausnahme = { pfad: '/src/weg.tsx', text: 'Standard', grund: 'Probe' };
    expect(befunde({}, [tot])).toEqual(['tote Ausnahme: /src/weg.tsx „Standard“']);
  });
});
