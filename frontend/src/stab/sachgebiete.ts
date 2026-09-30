import type { FuehrungsfunktionEintrag, Sachgebiet } from '../api/types';

/**
 * Die sechs Sachgebiete als feste Zeilen.
 *
 * S1–S6 sind AUFGABENZUORDNUNGEN, keine Arbeitsplätze: eine Zeile je Sachgebiet, ein Kurztext
 * als Merkhilfe (FwDV 100 Anlage 2) und Deeplinks in die Arbeitsmodule.
 * `label` ist wortgleich mit `Sachgebiet::label` in `src/stab/mod.rs` — das STANDARDlabel. Angezeigt
 * wird das wirksame Mandantenlabel aus dem Funktionskatalog ({@link mitWirksamemLabel}, LFH-549),
 * dasselbe, das der Server in den System-ETB schreibt; das Standardlabel ist nur der Rückfall,
 * solange der Katalog nicht geladen ist. `aufgaben` ist gekürzt, nicht zitiert.
 * `werkzeuge` sind Registry-SCHLÜSSEL; die Freigabe entscheidet `stab/werkzeuge.ts` zur
 * Laufzeit. Höchstens drei je Zeile, damit sie im Fükw nicht umbricht.
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
    // Verpflegung statt Fahrzeuge: höchstens drei Werkzeuge, und die Verpflegung ist wörtlich
    // Aufgabe von S4 („Verpflegung und Materialerhaltung").
    werkzeuge: ['nachforderungen', 'verpflegung', 'material'],
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
