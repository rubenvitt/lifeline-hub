import type { FuehrungsfunktionEintrag, Sachgebiet } from '../api/types';

/**
 * Die sechs Sachgebiete als feste Zeilen (FwDV 100 Anlage 2), für Organigramm, Fernmeldeskizze
 * und Einsatzbericht (i6k6mzed, design.md D5/D7).
 *
 * S1–S6 sind AUFGABENZUORDNUNGEN, keine Arbeitsplätze. `label` ist wortgleich mit
 * `Sachgebiet::label` in `src/fuehrung/sachgebiet.rs` — das STANDARDlabel. Angezeigt wird das
 * wirksame Mandantenlabel aus dem Funktionskatalog ({@link mitWirksamemLabel}, LFH-549),
 * dasselbe, das der Server in den System-ETB schreibt; das Standardlabel ist nur der Rückfall,
 * solange der Katalog nicht geladen ist.
 */
export interface SachgebietEintrag {
  sachgebiet: Sachgebiet;
  kuerzel: string;
  label: string;
}

export const SACHGEBIETE: readonly SachgebietEintrag[] = [
  { sachgebiet: 's1', kuerzel: 'S1', label: 'Personal' },
  { sachgebiet: 's2', kuerzel: 'S2', label: 'Lage' },
  { sachgebiet: 's3', kuerzel: 'S3', label: 'Einsatz' },
  { sachgebiet: 's4', kuerzel: 'S4', label: 'Versorgung' },
  { sachgebiet: 's5', kuerzel: 'S5', label: 'Presse- und Medienarbeit' },
  { sachgebiet: 's6', kuerzel: 'S6', label: 'Information und Kommunikation' },
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
