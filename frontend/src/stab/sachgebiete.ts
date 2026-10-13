import type { FuehrungsfunktionEintrag, Sachgebiet } from '../api/types';

/**
 * Die sechs Sachgebiete als feste Zeilen.
 *
 * S1–S6 sind AUFGABENZUORDNUNGEN, keine Arbeitsplätze: eine Kachel je Sachgebiet, ein Kurztext
 * als Merkhilfe (FwDV 100 Anlage 2) und die Werkzeuge des Sachgebiets (LLH-1124).
 * `label` ist wortgleich mit `Sachgebiet::label` in `src/stab/mod.rs` — das STANDARDlabel. Angezeigt
 * wird das wirksame Mandantenlabel aus dem Funktionskatalog ({@link mitWirksamemLabel}, LFH-549),
 * dasselbe, das der Server in den System-ETB schreibt; das Standardlabel ist nur der Rückfall,
 * solange der Katalog nicht geladen ist. `aufgaben` ist gekürzt, nicht zitiert.
 * `werkzeuge` sind Registry-Module oder Unterseiten aus `stab/unterseiten.ts`, in der Reihenfolge
 * der Kachel; die Freigabe entscheidet `stab/werkzeuge.ts` zur Laufzeit, für beide Arten gleich.
 * Eine Grenze für ihre Zahl gibt es nicht mehr: die Kachel bricht die Werkzeuge in ihr Raster um
 * (`openspec/changes/archive/2026-10-13-o5nxgqbl-stab-uebersicht/design.md`, D2).
 */
/** Ein Werkzeug einer Kachel: ein Registry-Modul oder eine Unterseite (`stab/unterseiten.ts`). */
export type WerkzeugEintrag = { art: 'modul'; key: string } | { art: 'seite'; key: string };

const alsModul = (key: string): WerkzeugEintrag => ({ art: 'modul', key });
const alsSeite = (key: string): WerkzeugEintrag => ({ art: 'seite', key });

export interface SachgebietEintrag {
  sachgebiet: Sachgebiet;
  kuerzel: string;
  label: string;
  aufgaben: string;
  /** Seite in FwDV 100 Anlage 2. */
  seite: number;
  werkzeuge: readonly WerkzeugEintrag[];
}

export const SACHGEBIETE: readonly SachgebietEintrag[] = [
  {
    sachgebiet: 's1',
    kuerzel: 'S1',
    label: 'Personal',
    aufgaben:
      'Kräfte anfordern und nachalarmieren, Kräfteübersicht führen, Bereitstellungsräume einrichten',
    seite: 55,
    // Nachforderungen auch hier: S1 fordert Kräfte an (Anlage 2), S4 Einsatzmittel.
    werkzeuge: [
      alsModul('personal'),
      alsModul('einheiten'),
      alsModul('bereitstellungsraeume'),
      alsModul('nachforderungen'),
    ],
  },
  {
    sachgebiet: 's2',
    kuerzel: 'S2',
    label: 'Lage',
    aufgaben:
      'Lage feststellen, Lagekarte und Einsatztagebuch führen, Lagebesprechungen vorbereiten',
    seite: 56,
    werkzeuge: [alsModul('lagekarte'), alsModul('lagemeldungen'), alsModul('etb')],
  },
  {
    sachgebiet: 's3',
    kuerzel: 'S3',
    label: 'Einsatz',
    aufgaben: 'Lage beurteilen, Abschnitte ordnen, Lagebesprechungen durchführen, Befehle erteilen',
    seite: 57,
    werkzeuge: [alsModul('einsatzabschnitte'), alsModul('auftraege'), alsModul('meldungen')],
  },
  {
    sachgebiet: 's4',
    kuerzel: 'S4',
    label: 'Versorgung',
    aufgaben: 'Einsatzmittel und Verbrauchsgüter anfordern, Verpflegung und Materialerhaltung',
    seite: 58,
    // Verpflegung statt Fahrzeuge: die Verpflegung ist wörtlich Aufgabe von S4 („Verpflegung und
    // Materialerhaltung"), die Fahrzeuge gehören zu den Kräften (Spec `kraefte-verpflegung`).
    werkzeuge: [alsModul('nachforderungen'), alsModul('verpflegung'), alsModul('material')],
  },
  {
    sachgebiet: 's5',
    kuerzel: 'S5',
    label: 'Presse- und Medienarbeit',
    aufgaben: 'Presse- und Medienlage, Presseinformationen, Informationstelefone',
    seite: 59,
    werkzeuge: [alsSeite('presse'), alsSeite('infotelefon')],
  },
  {
    sachgebiet: 's6',
    kuerzel: 'S6',
    label: 'Information und Kommunikation',
    aufgaben: 'Fernmeldeorganisation mit S3 absprechen, Kanäle aufteilen, Funkplan führen',
    seite: 60,
    // Die Einstiege des Fernmeldewesens (LLH-1180), keine Module anderer Sachgebiete.
    werkzeuge: [
      alsSeite('funkplan'),
      alsSeite('fernmeldeskizze'),
      alsSeite('sprechgruppen'),
      alsSeite('kommunikationsplan'),
    ],
  },
];

/**
 * Die sechs Zeilen mit dem wirksamen Label der Organisation (THW: „Versorgung (Logistik)“,
 * LFH-549). Ohne Katalogeintrag bleibt das Standardlabel.
 */
export function mitWirksamemLabel(
  katalog: readonly FuehrungsfunktionEintrag[],
): readonly SachgebietEintrag[] {
  return SACHGEBIETE.map((s) => {
    const eintrag = katalog.find((e) => e.funktion === s.sachgebiet);
    return eintrag ? { ...s, label: eintrag.label } : s;
  });
}
