import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ohneKommentare } from '../test/ohneKommentare';
import { quellwurzel } from '../test/ratsche';

/**
 * Feld-Wächter (Spec `feldbreiten`, „Keine feste Feldbreite im Verwaltungsteil", Change
 * `hzru8iq7-text-stapel-meta-feld`, design.md D7; auf die Führungsmodule ausgeweitet mit
 * LLH-1969). Löst den Feldbreiten-Guard aus LFH-329 · B1 ab.
 *
 * Ein Eingabefeld bekommt seine Breite nur über `Feld` (`components/instrument/Feld.tsx`) mit einer
 * benannten Obergrenze; dann ist es fluid und ragt am schmalen Schirm nicht über den Rand. Der
 * Wächter prüft in den Bereichen aus {@link BEREICHE}:
 *
 * 1. kein `<Form.Item` — Formularfelder sind `Feld`;
 * 2. keine Breite (`width`, `maxWidth`, `minWidth`, als Zahl, String oder Konstante) im `style`
 *    eines Eingabefelds und keine Stil-Konstante dort (`style={SELECT_STIL}`), die eine Breite
 *    verstecken könnte (`Input`, `InputNumber`, `Select`, `DatePicker`, `TimePicker`,
 *    `AutoComplete` samt Unterformen);
 * 3. keine feste Zahlbreite (`width: <Zahl>`) überhaupt, außer an den zugelassenen Stellen, die
 *    keine Eingabefelder sind (Tabellenspalten, Fortschrittsbalken).
 *
 * ── BEKANNTE GRENZEN ──
 * 1. Regel 2 sieht das Eingabefeld nur, solange zwischen Elementname und `style=` kein `>` steht
 *    (Pfeilfunktion in einer Prop davor).
 * 2. Der Scan hört an den Bereichen aus {@link BEREICHE} auf; außerhalb gilt die Regel ebenso,
 *    wird aber erst mit der Umstellung des Bereichs erzwungen.
 */

const SRC = quellwurzel('Feld-Wächter');

/**
 * Die geprüften Bereiche: der Verwaltungsteil (Stammdaten, Karten, globale Einstellungen,
 * Benutzer; LLH-1810) und die Führungsmodule ETB, Aufträge, Meldungen, Nachforderungen,
 * Lageberichte, Erinnerungen und Chat (LLH-1969).
 */
const BEREICHE = [
  'stammdaten',
  'karten',
  'pages/einstellungen',
  'pages/BenutzerPage.tsx',
  'etb',
  'auftraege',
  'meldungen',
  'nachforderungen',
  'lageberichte',
  'erinnerung',
  'chat',
];

/** Was eine feste Zahlbreite behalten darf, wie oft — und warum. Keine davon ist ein Eingabefeld. */
const ZUGELASSEN: Readonly<Record<string, { anzahl: number; grund: string }>> = {
  'stammdaten/StichworteTab.tsx': { anzahl: 1, grund: 'Spaltenbreite einer Tabellenspalte' },
  'karten/OfflineKartenVerwaltung.tsx': { anzahl: 1, grund: 'Fortschrittsbalken des Downloads' },
  // Neben der Fließspalte trägt jede übrige Spalte eine Zahl (LFH-523), sonst bleibt die fixierte
  // Namensspalte ungedeckelt (LFH-819).
  'pages/BenutzerPage.tsx': {
    anzahl: 2,
    grund: 'Spaltenbreiten der Benutzertabelle neben ihrer Fließspalte',
  },
};

const FORM_ITEM = /<Form\.Item\b/g;
const EINGABE_STIL =
  /<(?:Input(?:\.(?:TextArea|Password|Search))?|InputNumber|Select|DatePicker(?:\.RangePicker)?|TimePicker|AutoComplete)(?:<[^<>]*>)?(?=[\s/>])[^>]*?\bstyle=\{\{[^}]*?\b(?:width|maxWidth|minWidth)\s*:/g;
const EINGABE_STIL_KONSTANTE =
  /<(?:Input(?:\.(?:TextArea|Password|Search))?|InputNumber|Select|DatePicker(?:\.RangePicker)?|TimePicker|AutoComplete)(?:<[^<>]*>)?(?=[\s/>])[^>]*?\bstyle=\{\s*[A-Za-z_$][\w$.]*\s*\}/g;
const FESTE_BREITE = /\bwidth:\s*\d/g;

export interface Quelle {
  pfad: string;
  text: string;
}

function zeileVon(text: string, index: number): number {
  return text.slice(0, index).split('\n').length;
}

/** Befunde über die Quellen. Leer = in Ordnung. */
export function feldBefunde(
  quellen: readonly Quelle[],
  zugelassen: typeof ZUGELASSEN = ZUGELASSEN,
): string[] {
  const meldungen: string[] = [];
  for (const { pfad, text } of quellen) {
    for (const m of text.matchAll(FORM_ITEM)) {
      meldungen.push(`${pfad}:${zeileVon(text, m.index)}  Form.Item — Feld mit breite nehmen`);
    }
    for (const m of text.matchAll(EINGABE_STIL)) {
      meldungen.push(
        `${pfad}:${zeileVon(text, m.index)}  Breite am Eingabefeld — Feld breite="kurz|schmal|mittel|voll"`,
      );
    }
    for (const m of text.matchAll(EINGABE_STIL_KONSTANTE)) {
      meldungen.push(
        `${pfad}:${zeileVon(text, m.index)}  Stil-Konstante am Eingabefeld — Breite nur über Feld bzw. Hülle`,
      );
    }
    const fest = [...text.matchAll(FESTE_BREITE)];
    const erlaubt = zugelassen[pfad]?.anzahl ?? 0;
    if (fest.length !== erlaubt) {
      meldungen.push(
        `${pfad}: ${fest.length} feste Zahlbreiten, zugelassen ${erlaubt} (Zeilen ${fest
          .map((m) => zeileVon(text, m.index))
          .join(', ')})`,
      );
    }
  }
  return meldungen;
}

/** Liest einen Bereich ein — eine einzelne Datei oder ein Verzeichnis, Tests ausgenommen. */
function sammleDateien(bereich: string): Quelle[] {
  const voll = join(SRC, bereich);
  if (!existsSync(voll)) throw new Error(`Feld-Wächter: ${bereich} fehlt`);
  const lies = (pfad: string) => ohneKommentare(readFileSync(pfad, 'utf8')).join('\n');
  if (bereich.endsWith('.tsx')) return [{ pfad: bereich, text: lies(voll) }];
  const treffer: Quelle[] = [];
  const rein = (verzeichnis: string, rel: string) => {
    for (const eintrag of readdirSync(verzeichnis, { withFileTypes: true })) {
      const kind = join(verzeichnis, eintrag.name);
      const kindRel = `${rel}/${eintrag.name}`;
      if (eintrag.isDirectory()) rein(kind, kindRel);
      else if (eintrag.name.endsWith('.tsx') && !eintrag.name.includes('.test.')) {
        treffer.push({ pfad: kindRel, text: lies(kind) });
      }
    }
  };
  rein(voll, bereich);
  return treffer;
}

const QUELLEN = BEREICHE.flatMap(sammleDateien);

describe('Feld-Wächter: Felder im Verwaltungsteil (Spec `feldbreiten`)', () => {
  it('kein Form.Item, keine Breite am Eingabefeld, keine feste Zahlbreite außer zugelassen', () => {
    const meldungen = feldBefunde(QUELLEN, ZUGELASSEN);
    expect(meldungen, meldungen.join('\n')).toEqual([]);
  });

  it('sieht die Bereiche wirklich — sonst ist der Wächter eine Attrappe', () => {
    expect(QUELLEN.length).toBeGreaterThan(50);
    expect(QUELLEN.some((q) => q.pfad === 'stammdaten/FahrzeugDetailPage.tsx')).toBe(true);
  });

  describe('Regeln an Texten', () => {
    const q = (text: string): Quelle[] => [{ pfad: 'x.tsx', text }];

    it('meldet Form.Item mit Zeile', () => {
      expect(feldBefunde(q('a\n<Form.Item name="a">'), {})).toEqual([
        'x.tsx:2  Form.Item — Feld mit breite nehmen',
      ]);
    });

    it('meldet Breiten am Eingabefeld als Zahl, String und Konstante', () => {
      const text = [
        "<Input style={{ width: '100%' }} />",
        '<InputNumber min={0} style={{ maxWidth: BREITE }} />',
        '<Select\n  options={o}\n  style={{ minWidth: 160 }}\n/>',
        '<Input.TextArea style={{ resize: "none" }} />',
        '<Select<number>\n  value={v}\n  style={{ width: 200 }}\n/>',
      ].join('\n');
      const meldungen = feldBefunde(q(text), { 'x.tsx': { anzahl: 0, grund: '' } });
      expect(meldungen.filter((m) => m.includes('Breite am Eingabefeld'))).toHaveLength(4);
    });

    it('meldet eine Stil-Konstante am Eingabefeld, aber keinen Stil-Aufruf', () => {
      const text = [
        '<Select<number> options={o} style={SELECT_STYLE} />',
        '<Input style={monoStil(14)} />',
      ].join('\n');
      const meldungen = feldBefunde(q(text), {});
      expect(meldungen).toEqual([
        'x.tsx:1  Stil-Konstante am Eingabefeld — Breite nur über Feld bzw. Hülle',
      ]);
    });

    it('meldet feste Zahlbreiten auch abseits von Feldern, außer zugelassen in genauer Zahl', () => {
      const text = '<div style={{ width: 200 }} />';
      expect(feldBefunde(q(text), {})).toHaveLength(1);
      expect(feldBefunde(q(text), { 'x.tsx': { anzahl: 1, grund: 'Balken' } })).toEqual([]);
      expect(feldBefunde(q(text), { 'x.tsx': { anzahl: 2, grund: 'Balken' } })).toHaveLength(1);
    });
  });
});
