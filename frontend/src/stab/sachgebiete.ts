import type { Sachgebiet } from '../api/types';

/**
 * Die sechs Sachgebiete als feste Zeilen (Spec LFH-46, Entscheidung 2 und Abschnitt 2.2).
 *
 * S1–S6 sind im Produkt AUFGABENZUORDNUNGEN, keine Arbeitsplätze: eine Zeile je Sachgebiet,
 * ein Kurztext als Merkhilfe („Anregung, Erinnerung und Unterstützung", FwDV 100 Anlage 2,
 * S. 54) und Deeplinks in die Module, in denen gearbeitet wird.
 *
 * `label` ist wortgleich mit `Sachgebiet::label` in `src/stab/mod.rs` — der System-ETB-Eintrag
 * trägt dieselbe Bezeichnung, und Zeile und Führungsnachweis dürfen nicht auseinanderlaufen.
 * `aufgaben` ist gekürzt, nicht zitiert; die Seite verweist auf den Wortlaut.
 *
 * `werkzeuge` sind Registry-SCHLÜSSEL, nicht Pfade: die Freigabe (Status, Override, Rolle)
 * entscheidet `stab/werkzeuge.ts` zur Laufzeit. Höchstens drei je Zeile, damit die Zeile
 * im Fükw (≈ 1022 px Content) nicht umbricht.
 */
export interface SachgebietEintrag {
  sachgebiet: Sachgebiet;
  kuerzel: string;
  label: string;
  aufgaben: string;
  /** Seite in FwDV 100 Anlage 2. */
  seite: number;
  werkzeuge: readonly string[];
}

export const SACHGEBIETE: readonly SachgebietEintrag[] = [
  {
    sachgebiet: 's1',
    kuerzel: 'S1',
    label: 'Personal',
    aufgaben:
      'Kräfte anfordern und nachalarmieren, Kräfteübersicht führen, Bereitstellungsräume einrichten',
    seite: 55,
    werkzeuge: ['personal', 'einheiten', 'bereitstellungsraeume'],
  },
  {
    sachgebiet: 's2',
    kuerzel: 'S2',
    label: 'Lage',
    aufgaben:
      'Lage feststellen, Lagekarte und Einsatztagebuch führen, Lagebesprechungen vorbereiten',
    seite: 56,
    werkzeuge: ['lagekarte', 'lagemeldungen', 'etb'],
  },
  {
    sachgebiet: 's3',
    kuerzel: 'S3',
    label: 'Einsatz',
    aufgaben: 'Lage beurteilen, Abschnitte ordnen, Lagebesprechungen durchführen, Befehle erteilen',
    seite: 57,
    werkzeuge: ['einsatzabschnitte', 'auftraege', 'meldungen'],
  },
  {
    sachgebiet: 's4',
    kuerzel: 'S4',
    label: 'Versorgung',
    aufgaben: 'Einsatzmittel und Verbrauchsgüter anfordern, Verpflegung und Materialerhaltung',
    seite: 58,
    werkzeuge: ['nachforderungen', 'material', 'fahrzeuge'],
  },
  {
    sachgebiet: 's5',
    kuerzel: 'S5',
    label: 'Presse- und Medienarbeit',
    aufgaben: 'Presse- und Medienlage, Presseinformationen, Informationstelefone',
    seite: 59,
    werkzeuge: [],
  },
  {
    sachgebiet: 's6',
    kuerzel: 'S6',
    label: 'Information und Kommunikation',
    aufgaben: 'Fernmeldeorganisation mit S3 absprechen, Kanäle aufteilen, Funkplan führen',
    seite: 60,
    werkzeuge: ['einsatzabschnitte', 'chat'],
  },
];
