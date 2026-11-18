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
import { SCHULD } from './schriftgroesse.schuld';

/**
 * Schriftstufen (Spec `schriftstufen`, „Keine neuen freien Schriftgrößen“, Change
 * `hzru8iq7-text-stapel-meta-feld`, design.md D7): **keine neue Schriftgröße als Zahl.** Text
 * nimmt seine Größe aus einer Stufe der `schriftskala`: in TSX über `Textstufe` oder
 * `schriftStil(stufe)`, in CSS über `var(--lfh-typo-<stufe>-groesse)`.
 *
 * Gezählt wird außerhalb von Kommentaren:
 * - TS/TSX: `fontSize` mit einer Zahl oder einem px-String;
 * - CSS: `font-size` mit einem px-Wert, außer in `theme/`.
 *
 * ── SCHULD (`schriftgroesse.schuld.ts`) ──
 * Die Zahl der Literale je Datei beim Einführen. Mehr Funde als die Schuld sind rot, weniger
 * auch: wer abbaut, senkt die Zahl im selben Commit. Bei 0 fällt der Eintrag.
 *
 * ── BEKANNTE GRENZEN (Teil des Vertrags) ──
 * 1. `monoStil(<Zahl>)` zählt nicht (Folgeaufgabe Mono-Stufe); ebenso Werte aus Variablen.
 * 2. `fontSize` als antd-Token (`token: { fontSize: 12 }`) zählt mit — es ist dieselbe freie Größe.
 * 3. Testdateien zählen nicht, Druckansichten auch außerhalb von `druck/` nicht.
 */

const SRC = quellwurzel('Schriftgrößen-Wächter');

/** `theme/` trägt die Skala selbst und antds Grundschrift je Dichte. */
export const AUSNAHMEN: Readonly<Record<string, string>> = {
  ...DICHTE_AUSNAHMEN,
  'theme/': 'Quelle der Skala und der Grundschrift je Dichte',
};

const TS_ZAHL = /\bfontSize\s*:\s*(\d+(?:\.\d+)?)(?![\w.])/g;
const TS_TEXT = /\bfontSize\s*:\s*(['"`])(\d+(?:\.\d+)?)px\1/g;
const CSS_DEKL = /(?:^|[\s;{])font-size\s*:\s*(\d+(?:\.\d+)?)px\b/g;

/** Alle Schriftgrößen-Literale einer Datei (`.css` oder TS/TSX) außerhalb von Kommentaren. */
export function schriftgroessen(pfad: string, inhalt: string): Fund[] {
  const text = ohneKommentare(inhalt).join('\n');
  const muster = pfad.endsWith('.css') ? [CSS_DEKL] : [TS_ZAHL, TS_TEXT];
  const funde: Fund[] = [];
  for (const m of muster) {
    for (const t of text.matchAll(m)) {
      funde.push({ zeile: zeileVon(text, t.index), wert: Number(t[2] ?? t[1]) });
    }
  }
  return funde.sort((a, b) => a.zeile - b.zeile);
}

function ausgenommen(pfad: string, ausnahmen: Readonly<Record<string, string>>): boolean {
  return (
    Object.keys(ausnahmen).some((p) => pfad.startsWith(p)) ||
    (ausnahmen === AUSNAHMEN && DRUCKDATEI.test(pfad))
  );
}

export function befunde(
  dateien: Readonly<Record<string, string>>,
  schuld: Readonly<Record<string, number>>,
  ausnahmen: Readonly<Record<string, string>> = AUSNAHMEN,
): string[] {
  return ratschenBefunde(
    {
      funde: schriftgroessen,
      ausgenommen: (pfad) => ausgenommen(pfad, ausnahmen),
      was: 'Schriftgrößen-Literale',
      hinweis:
        'Größe aus einer Stufe nehmen (Textstufe, schriftStil(stufe), var(--lfh-typo-*-groesse))',
      schuldDatei: 'schriftgroesse.schuld.ts',
    },
    dateien,
    schuld,
  );
}

const dateien = liesBaum(SRC);

describe('Schriftstufen: keine neue freie Schriftgröße (Spec `schriftstufen`)', () => {
  it('kein Literal über der Schuld, und die Schuld ist auf dem Stand', () => {
    const meldungen = befunde(dateien, SCHULD);
    expect(meldungen, meldungen.join('\n')).toEqual([]);
  });

  it('sieht den Baum wirklich — sonst ist der Wächter eine Attrappe', () => {
    expect(Object.keys(dateien).length).toBeGreaterThan(300);
    expect(dateien['components/instrument/Textstufe.tsx'] ?? '').not.toBe('');
  });

  describe('Regeln an Texten', () => {
    it('meldet Zahlen und px-Strings im Stilobjekt, keine Variablen', () => {
      const ts = [
        'const a = { fontSize: 13, lineHeight: 1.5 };',
        "const b = { fontSize: '15px' };",
        'const c = { fontSize: token.fontSizeSM, ...schriftStil("text") };',
        'const d = monoStil(11);',
      ].join('\n');
      expect(schriftgroessen('a.tsx', ts)).toEqual([
        { zeile: 1, wert: 13 },
        { zeile: 2, wert: 15 },
      ]);
    });

    it('meldet px in CSS, keine Variablen und keine Zeilenhöhe', () => {
      const css = [
        '.a { font-size: 13px; line-height: 20px; }',
        '.b { font-size: var(--lfh-typo-text-groesse); }',
      ].join('\n');
      expect(schriftgroessen('a.css', css)).toEqual([{ zeile: 1, wert: 13 }]);
    });

    it('lässt Kommentare in Ruhe', () => {
      expect(schriftgroessen('a.tsx', '// fontSize: 13\n/* fontSize: 12 */')).toEqual([]);
    });

    it('eine neue Datei mit Literal ist rot und nennt Datei, Zeile und Wert', () => {
      const meldung = befunde({ 'neu.tsx': 'const a = { fontSize: 13 };' }, {}, {});
      expect(meldung).toHaveLength(1);
      expect(meldung[0]).toContain('neu.tsx:1  13');
    });

    it('Schuld getroffen ist grün, unterschritten ist rot', () => {
      const datei = { 'alt.tsx': 'const a = { fontSize: 12 };' };
      expect(befunde(datei, { 'alt.tsx': 1 }, {})).toEqual([]);
      expect(befunde(datei, { 'alt.tsx': 2 }, {})[0]).toContain('Schuld senken');
    });

    it('nimmt Skala, Druck und Lagemonitor aus', () => {
      const ts = 'const a = { fontSize: 40 };';
      expect(
        befunde(
          {
            'theme/tokens.ts': ts,
            'druck/Kopf.tsx': ts,
            'pages/EtbDruckPage.tsx': ts,
            'geraet/LagemonitorSeite.tsx': ts,
          },
          {},
        ),
      ).toEqual([]);
    });
  });
});
