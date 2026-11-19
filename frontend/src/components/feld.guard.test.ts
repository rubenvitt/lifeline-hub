import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ohneKommentare } from '../test/ohneKommentare';
import { quellwurzel } from '../test/ratsche';

/**
 * Feld-Wächter (Spec `feldbreiten`, „Keine feste Feldbreite im Verwaltungsteil", Change
 * `hzru8iq7-text-stapel-meta-feld`, design.md D7; auf die Führungsmodule ausgeweitet mit
 * LLH-1969, auf Personen, Betreuung, Verpflegung, Kräfte und Ablösung mit LLH-1970). Löst den
 * Feldbreiten-Guard aus LFH-329 · B1 ab.
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
 *    wird aber erst mit der Umstellung des Bereichs erzwungen (LLH-1968 bis LLH-1971).
 * 3. `AUSGESPART` nimmt einzelne Dateien eines Bereichs aus, bis ein Baustein nachgezogen ist.
 */

const SRC = quellwurzel('Feld-Wächter');

/**
 * Die geprüften Bereiche: der Verwaltungsteil (Stammdaten, Karten, globale Einstellungen,
 * Benutzer; LLH-1810), die Einsatzseiten unter `pages/` samt Fachbereichen und Restbereichen
 * (LLH-1971), die Führungsmodule ETB, Aufträge, Meldungen, Nachforderungen, Lageberichte,
 * Erinnerungen und Chat (LLH-1969) und die Einsatzmodule Personen, Betreuung, Verpflegung,
 * Kräfte und Ablösung (LLH-1970).
 */
const BEREICHE = [
  'stammdaten',
  'karten',
  'pages',
  'geraet',
  'wetter',
  'fernmeldewesen',
  'planung',
  'aufbewahrung',
  'instanz',
  'fuehrung',
  'admin',
  'auth',
  'druck',
  'entwurf',
  'extern',
  'hilfe',
  'infotelefon',
  'kommunikation',
  'lagebesprechung',
  'live',
  'marke',
  'neuigkeiten',
  'offline',
  'programmpunkt',
  'routes',
  'zeichen',
  'zugangsprotokoll',
  'etb',
  'auftraege',
  'meldungen',
  'nachforderungen',
  'lageberichte',
  'erinnerung',
  'chat',
  'personen',
  'betreuung',
  'verpflegung',
  'kraefte',
  'abloesung',
];

/**
 * Dateien in einem Bereich, die der Wächter noch nicht prüft — je mit der Aufgabe, nach der sie
 * dazukommen. Neue Einträge gibt es nicht; eine erledigte Aufgabe streicht ihre.
 */
const AUSGESPART: Readonly<Record<string, string>> = {
  // `DatenfeldEingabe` klont sein Kind mit der Label-`id` und kennt noch keine Breite (LLH-2000).
  'pages/uhs/UhsAngaben.tsx': 'LLH-2000',
  'pages/BetreuungsstelleDetailPage.tsx': 'LLH-2000',
  'pages/SchaedenDetailPage.tsx': 'LLH-2000',
  'pages/TiereDetailPage.tsx': 'LLH-2000',
};

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
  'pages/DokumentePage.tsx': { anzahl: 5, grund: 'Spaltenbreiten der Dokumententabelle' },
  'pages/EinheitenPage.tsx': { anzahl: 5, grund: 'Spaltenbreiten der Einheitentabelle' },
  'pages/EinsaetzePage.tsx': { anzahl: 1, grund: 'Statuspunkt der Einsatzkachel' },
  'pages/FahrzeugePage.tsx': { anzahl: 9, grund: 'Spaltenbreiten der Fahrzeugtabelle' },
  // `fernmeldewesen/AGENTS.md`: die Summe der festen Spaltenbreiten bleibt 630.
  'pages/FunkplanPage.tsx': { anzahl: 9, grund: 'Spaltenbreiten von Funkplan und Sprechgruppen' },
  'pages/KommunikationsplanPage.tsx': {
    anzahl: 3,
    grund: 'Spaltenbreiten des Kommunikationsplans',
  },
  'pages/KraefteuebersichtPage.tsx': { anzahl: 8, grund: 'Spaltenbreiten des Meldebilds' },
  'pages/MaterialPage.tsx': { anzahl: 6, grund: 'Spaltenbreiten der Materialtabelle' },
  'pages/PersonalPage.tsx': { anzahl: 10, grund: 'Spaltenbreiten der Personaltabelle' },
  'pages/TierePage.tsx': { anzahl: 3, grund: 'Spaltenbreiten der Tiertabelle' },
  'pages/bereitstellungsraum/KraefteOhneBrSidebar.tsx': {
    anzahl: 1,
    grund: 'Seitenleiste neben dem Bereitstellungsraum ab md',
  },
  'pages/gefahren/ErlaeuterungsMarke.tsx': { anzahl: 1, grund: 'CSS-Dreieck der Marke (Breite 0)' },
  'pages/gefahren/GefahrenPage.tsx': { anzahl: 1, grund: 'Spalte „Gefahrengebiete“ ab lg' },
  'pages/lage-dashboard/LagePaneele.tsx': { anzahl: 1, grund: 'Farbfeld der Verlaufslegende' },
  'pages/lagekarte/KartenUeberlagerung.tsx': {
    anzahl: 1,
    grund: 'nur vorgelesener Text (Breite 1)',
  },
  'pages/lagekarte/Klassenlegende.tsx': { anzahl: 1, grund: 'gezeichneter Legendenpunkt' },
  'geraet/GeraetBetroffenePage.tsx': { anzahl: 1, grund: 'Spaltenbreite „Verbleib“' },
  'geraet/GeraetPatientenPage.tsx': { anzahl: 1, grund: 'Spaltenbreite „Platz“' },
  'fernmeldewesen/SkizzenAufnahme.tsx': {
    anzahl: 1,
    grund: 'feste Fläche, von der die Skizze als Bild aufgenommen wird',
  },
  'aufbewahrung/ArchivAktePage.tsx': { anzahl: 19, grund: 'Spaltenbreiten der Registertabellen' },
  'aufbewahrung/AufbewahrungUebersicht.tsx': { anzahl: 9, grund: 'Spaltenbreiten der Übersicht' },
  'aufbewahrung/Loeschersuchen.tsx': { anzahl: 8, grund: 'Spaltenbreiten der Löschersuchen' },
  'aufbewahrung/PersonensucheDialog.tsx': { anzahl: 6, grund: 'Spaltenbreiten der Trefferliste' },
  'admin/AdminLayout.tsx': { anzahl: 1, grund: 'Flex-Basis 0 des Inhalts neben dem Sider' },
  'zugangsprotokoll/ZugangsprotokollPage.tsx': {
    anzahl: 9,
    grund: 'Spaltenbreiten des Zugangsprotokolls',
  },
  'chat/KanalListe.tsx': { anzahl: 1, grund: 'visuell verborgene Vorleserfläche (Clip)' },
  'etb/EtbSpaltenzeile.tsx': { anzahl: 1, grund: 'visuell verborgene Vorleserfläche (Clip)' },
  'etb/EtbEintragVorschau.tsx': { anzahl: 1, grund: '2-px-Typkante der Vorschau' },
  'etb/EtbFeldzeile.tsx': {
    anzahl: 3,
    grund: '6-px-Typpunkt in Menü und Typ-Knopf, 32-px-Spalte des Feldworts am Handschirm',
  },
  // Einsatzmodule (LLH-1970).
  'personen/personenSpalten.tsx': {
    anzahl: 9,
    grund: 'Spaltenbreiten der Betroffenenliste und der nur vorgelesene Spaltenkopf (1 px)',
  },
  'personen/BetroffeneZeile.tsx': { anzahl: 1, grund: 'nur vorgelesener Text (1 px)' },
  'personen/BetroffenenSeitenleiste.tsx': {
    anzahl: 1,
    grund: 'Kürzelspalte der Sichtungsliste',
  },
  'personen/Sichtungszeile.tsx': { anzahl: 1, grund: 'Farbfeld der Sichtungskategorie' },
  'personen/ZeilenSichtung.tsx': {
    anzahl: 1,
    grund: 'Popover-Breite aus drei Sichtungsflächen je Reihe',
  },
  'kraefte/DauerMitEinstufung.tsx': { anzahl: 1, grund: 'nur vorgelesener Text (1 px)' },
  'kraefte/EinheitZeichen.tsx': { anzahl: 1, grund: 'Kästchen des taktischen Zeichens' },
  'abloesung/schichtplan/SchichtplanRaster.tsx': {
    anzahl: 1,
    grund: 'senkrechte Jetzt-Linie im Raster',
  },
  'abloesung/schichtplan/planEditor.cases.tsx': {
    anzahl: 3,
    grund: 'Rechtecke als Testfälle des Planeditors',
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
      else if (
        eintrag.name.endsWith('.tsx') &&
        !eintrag.name.includes('.test.') &&
        !(kindRel in AUSGESPART)
      ) {
        treffer.push({ pfad: kindRel, text: lies(kind) });
      }
    }
  };
  rein(voll, bereich);
  return treffer;
}

const QUELLEN = BEREICHE.flatMap(sammleDateien);

describe('Feld-Wächter: Felder im Verwaltungsteil und den umgestellten Einsatzmodulen (Spec `feldbreiten`)', () => {
  it('kein Form.Item, keine Breite am Eingabefeld, keine feste Zahlbreite außer zugelassen', () => {
    const meldungen = feldBefunde(QUELLEN, ZUGELASSEN);
    expect(meldungen, meldungen.join('\n')).toEqual([]);
  });

  it('sieht die Bereiche wirklich — sonst ist der Wächter eine Attrappe', () => {
    expect(QUELLEN.length).toBeGreaterThan(300);
    expect(QUELLEN.some((q) => q.pfad === 'stammdaten/FahrzeugDetailPage.tsx')).toBe(true);
    expect(QUELLEN.some((q) => q.pfad === 'pages/lagekarte/Inspector.tsx')).toBe(true);
    expect(QUELLEN.some((q) => q.pfad === 'geraet/GeraetMeldenPage.tsx')).toBe(true);
    expect(QUELLEN.some((q) => q.pfad === 'personen/AufnahmeFelder.tsx')).toBe(true);
  });

  it('spart nur vorhandene Dateien aus, und nur solange sie noch einen Befund tragen', () => {
    for (const pfad of Object.keys(AUSGESPART)) {
      expect(existsSync(join(SRC, pfad)), `${pfad} fehlt — aus AUSGESPART streichen`).toBe(true);
      const text = ohneKommentare(readFileSync(join(SRC, pfad), 'utf8')).join('\n');
      expect(
        feldBefunde([{ pfad, text }], ZUGELASSEN).length,
        `${pfad} ist sauber — aus AUSGESPART streichen`,
      ).toBeGreaterThan(0);
    }
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
        "<Input style={monoStil('monoGross')} />",
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
