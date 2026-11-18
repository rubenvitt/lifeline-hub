import { describe, expect, it } from 'vitest';
import { ohneKommentare } from '../test/ohneKommentare';
import {
  DICHTE_AUSNAHMEN,
  DRUCKDATEI,
  liesBaum,
  quellwurzel,
  ratschenBefunde,
  zeileVon,
  type Fund,
} from '../test/ratsche';

/**
 * Abstandsraster (Spec `abstandsraster`, „Abstände ohne Literal“; ADR-0067): **kein
 * Abstands-Literal.** Innen- und Außenabstände und Lücken kommen aus dem Raster der aktiven
 * Dichte: in TSX über die antd-Tokens (`token.paddingSM`, `token.margin` …), in CSS über
 * `var(--lfh-luft-0…5)` aus `theme/rollen.css`.
 *
 * Gezählt wird außerhalb von Kommentaren:
 * - TS/TSX: `padding*`, `margin*`, `gap`, `rowGap`, `columnGap` mit einer Zahl oder einem
 *   px-String;
 * - JSX: `size={n}` an `<Space>`, `gap={n}` und `gutter={n | [n, n]}`;
 * - CSS: `padding*`, `margin*`, `gap`, `row-gap`, `column-gap` mit einem px-Wert, außer in
 *   `theme/rollen.css`.
 *
 * Nulltoleranz: Die Altlast ist abgebaut (LLH-1937), eine Schuld je Datei gibt es nicht mehr.
 * Jedes Literal außerhalb der Ausnahmen ist rot. Werte ohne Stufe entscheidet man einzeln: nächste
 * Stufe, Feinsatz (≤ 2 px) oder ein benannter Nicht-Layout-Wert (Kartenrand).
 *
 * ── BEKANNTE GRENZEN (Teil des Vertrags) ──
 * 1. Feinsatz bis 2 px (Haarlinie, Symbolversatz) und 0 sind frei.
 * 2. Werte aus Variablen oder Rechnungen (`x * 2`, `flaeche.zustandOben`) sieht der Wächter nicht;
 *    eine Zahl IN einer Rechnung (`padding: 8 * n`) zählt.
 * 3. `<Space … size={n}>` wird nur erkannt, solange zwischen `<Space` und `size=` kein `>` steht
 *    (Pfeilfunktion in einer Prop davor).
 * 4. Die Kurzschreibweise `padding: '8px 12px'` zählt je Wert.
 * 5. Testdateien zählen nicht. Druckansichten zählen auch außerhalb von `druck/` nicht
 *    (`DRUCKDATEI`, am Dateinamen erkannt).
 */

const SRC = quellwurzel('Abstandsraster-Wächter');

/** Die eine Quelle der Abstände in CSS. */
const ROLLENQUELLE = 'theme/rollen.css';

/** Flächen, die bewusst nicht der Bediendichte folgen (Spec, „Feste Ausnahmen mit Grund“). */
export const AUSNAHMEN = DICHTE_AUSNAHMEN;

/** Feinsatz (Haarlinie, Symbolversatz) zählt nicht. */
const FEINSATZ = 2;

const TS_PROP =
  /\b(?:padding|margin)(?:Top|Right|Bottom|Left|Inline|Block|InlineStart|InlineEnd|BlockStart|BlockEnd)?\b|\b(?:gap|rowGap|columnGap)\b/;
const TS_ZAHL = new RegExp(`(?:${TS_PROP.source})\\s*:\\s*(-?\\d+(?:\\.\\d+)?)(?![\\w.])`, 'g');
const TS_TEXT = new RegExp(`(?:${TS_PROP.source})\\s*:\\s*(['"\`])([^'"\`]*)\\1`, 'g');
const PX = /(-?\d+(?:\.\d+)?)px\b/g;
const JSX_SPACE = /<Space\b[^>]*?\bsize=\{\s*(\[[^\]]*\]|-?\d+(?:\.\d+)?)\s*\}/g;
const JSX_GAP = /\bgap=\{\s*(-?\d+(?:\.\d+)?)\s*\}/g;
const JSX_GAP_TEXT = /\bgap=(?:"([^"]*)"|\{\s*['"`]([^'"`]*)['"`]\s*\})/g;
const JSX_GUTTER = /\bgutter=\{\s*(\[[^\]]*\]|-?\d+(?:\.\d+)?)\s*\}/g;
const CSS_DEKL =
  /(?:^|[\s;{])(?:padding|margin)(?:-[a-z-]+)?\s*:\s*([^;}]*)|(?:^|[\s;{])(?:gap|row-gap|column-gap)\s*:\s*([^;}]*)/g;

export type { Fund };

function zaehlt(wert: number): boolean {
  return Math.abs(wert) > FEINSATZ;
}

function zahlenIn(text: string): number[] {
  return [...text.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
}

/** Alle Abstands-Literale einer Datei (`.css` oder TS/TSX) außerhalb von Kommentaren. */
export function abstandsliterale(pfad: string, inhalt: string): Fund[] {
  const text = ohneKommentare(inhalt).join('\n');
  const funde: Fund[] = [];
  const nimm = (index: number, werte: number[]) => {
    for (const wert of werte) if (zaehlt(wert)) funde.push({ zeile: zeileVon(text, index), wert });
  };
  if (pfad.endsWith('.css')) {
    for (const m of text.matchAll(CSS_DEKL)) {
      const wert = m[1] ?? m[2] ?? '';
      nimm(
        m.index,
        [...wert.matchAll(PX)].map((p) => Number(p[1])),
      );
    }
  } else {
    for (const m of text.matchAll(TS_ZAHL)) nimm(m.index, [Number(m[1])]);
    for (const m of text.matchAll(TS_TEXT)) {
      nimm(
        m.index,
        [...m[2].matchAll(PX)].map((p) => Number(p[1])),
      );
    }
    for (const m of text.matchAll(JSX_GAP_TEXT)) {
      nimm(
        m.index,
        [...(m[1] ?? m[2] ?? '').matchAll(PX)].map((p) => Number(p[1])),
      );
    }
    for (const muster of [JSX_SPACE, JSX_GAP, JSX_GUTTER]) {
      for (const m of text.matchAll(muster)) nimm(m.index, zahlenIn(m[1]));
    }
  }
  return funde.sort((a, b) => a.zeile - b.zeile);
}

function ausgenommen(pfad: string, ausnahmen: Readonly<Record<string, string>>): boolean {
  return (
    pfad === ROLLENQUELLE ||
    Object.keys(ausnahmen).some((p) => pfad.startsWith(p)) ||
    (ausnahmen === AUSNAHMEN && DRUCKDATEI.test(pfad))
  );
}

/**
 * Befunde über eine Menge Dateien (Pfad relativ zu `src/` → Inhalt). Leer = in Ordnung. Rein und
 * exportiert, damit die Regeln an Texten prüfbar sind.
 */
export function befunde(
  dateien: Readonly<Record<string, string>>,
  ausnahmen: Readonly<Record<string, string>> = AUSNAHMEN,
): string[] {
  // Leere Schuld: Nulltoleranz (ADR-0067), jeder Fund ist rot.
  return ratschenBefunde(
    {
      funde: abstandsliterale,
      ausgenommen: (pfad) => ausgenommen(pfad, ausnahmen),
      was: 'Abstands-Literale',
      hinweis: 'Abstand aus dem Raster nehmen (token.padding*/margin*, var(--lfh-luft-*))',
      schuldDatei: 'abstandsraster.guard.test.ts (Nulltoleranz, keine Schuld)',
    },
    dateien,
    {},
  );
}

const dateien = liesBaum(SRC);

describe('Abstandsraster: kein neues Abstands-Literal (Spec `abstandsraster`)', () => {
  it('kein Abstands-Literal außerhalb der Ausnahmen', () => {
    const meldungen = befunde(dateien);
    expect(meldungen, meldungen.join('\n')).toEqual([]);
  });

  it('sieht den Baum wirklich — sonst ist der Wächter eine Attrappe', () => {
    expect(Object.keys(dateien).length).toBeGreaterThan(300);
    expect(dateien['theme/tokens.ts'] ?? '').not.toBe('');
    expect(dateien['index.css'] ?? '').not.toBe('');
  });

  describe('Regeln an Texten', () => {
    it('meldet Zahlen im Stilobjekt, Feinsatz und 0 sind frei', () => {
      const ts = 'const a = { padding: 8, marginTop: 12, gap: 2, rowGap: 0, columnGap: -16 };';
      expect(abstandsliterale('a.tsx', ts).map((f) => f.wert)).toEqual([8, 12, -16]);
    });

    it('meldet px in Strings, auch in der Kurzschreibweise, aber keine Token-Rechnung', () => {
      const ts = [
        "const a = { padding: '8px 12px', margin: '1px 0' };",
        'const b = { padding: `${token.paddingSM}px ${token.padding}px` };',
      ].join('\n');
      expect(abstandsliterale('a.tsx', ts).map((f) => f.wert)).toEqual([8, 12]);
    });

    it('meldet Space size, gap= und gutter=, aber nicht size an anderen Bausteinen', () => {
      const tsx = [
        '<Space wrap size={8}>',
        '<Space size={[12, 4]} wrap>',
        '<Flex gap={16}>',
        '<Row gutter={[24, 2]}>',
        '<Avatar size={32} />',
        '<Space size={token.marginSM}>',
      ].join('\n');
      expect(abstandsliterale('a.tsx', tsx)).toEqual([
        { zeile: 1, wert: 8 },
        { zeile: 2, wert: 12 },
        { zeile: 2, wert: 4 },
        { zeile: 3, wert: 16 },
        { zeile: 4, wert: 24 },
      ]);
    });

    it('meldet px-Abstände in CSS, nicht Breiten und nicht Variablen', () => {
      const css = [
        '.a { padding: 8px 0; width: 120px; }',
        '.b {',
        '  margin-inline-start: var(--lfh-luft-2);',
        '  gap: 12px;',
        '  row-gap: 1px;',
        '}',
      ].join('\n');
      expect(abstandsliterale('a.css', css)).toEqual([
        { zeile: 1, wert: 8 },
        { zeile: 4, wert: 12 },
      ]);
    });

    it('lässt Kommentare in Ruhe', () => {
      expect(abstandsliterale('a.tsx', '// padding: 8\n/* gap: 12 */ const x = 1;')).toEqual([]);
      expect(abstandsliterale('a.css', '/* padding: 8px */')).toEqual([]);
    });

    it('eine Datei mit Literal ist rot, eine ohne grün', () => {
      const meldung = befunde({ 'neu.tsx': 'const a = { padding: 8 };' }, {});
      expect(meldung).toHaveLength(1);
      expect(meldung[0]).toContain('neu.tsx:1  8');
      expect(befunde({ 'gut.tsx': 'const a = { padding: token.paddingSM };' }, {})).toEqual([]);
    });

    it('meldet gap als String-Prop', () => {
      const tsx = ['<Flex gap="12px">', "<Flex gap={'8px'}>", '<Flex gap="small">'].join('\n');
      expect(abstandsliterale('a.tsx', tsx).map((f) => f.wert)).toEqual([12, 8]);
    });

    it('nimmt Druckansichten auch außerhalb von druck/ aus', () => {
      const css = '@media print { .x { padding: 6px; } }';
      expect(
        befunde({
          'pages/befehlPrint.css': css,
          'pages/EtbDruckPage.tsx': 'const a = { padding: 8 };',
        }),
      ).toEqual([]);
      expect(befunde({ 'pages/befehl.css': css })).toHaveLength(1);
      expect(befunde({ 'components/druck/DruckKnopf.tsx': '<Space size={12}>' })).toHaveLength(1);
    });

    it('nimmt Rollenquelle und Ausnahmen aus', () => {
      const css = '.a { padding: 8px; }';
      expect(befunde({ [ROLLENQUELLE]: css }, {})).toEqual([]);
      expect(befunde({ 'druck/x.css': css }, { 'druck/': 'Papier' })).toEqual([]);
      expect(befunde({ 'x.css': css }, { 'druck/': 'Papier' })).toHaveLength(1);
    });
  });
});
