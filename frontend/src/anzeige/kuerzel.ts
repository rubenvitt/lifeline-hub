/**
 * Die eingeführten Kürzel (LLH-1750, Spec `bedien-wortlaut`, „Kürzel sind eingeführt oder
 * erklärt“): nur sie darf die Oberfläche ohne Erklärung auf derselben Fläche zeigen. Jedes andere
 * Kürzel wird ausgeschrieben oder dort erklärt. Das Anwenderkapitel „Zeiten und Kürzel“
 * (`docs/anwender/kapitel/zeiten-und-kuerzel.md`) führt dieselbe Liste; `kuerzel.test.ts` hält beide
 * gleich. Ein neues Kürzel kommt hier UND ins Kapitel.
 *
 * Kurzbezeichnungen, die eine Organisation selbst vergibt („EA 1.1“), sind Daten, keine Kürzel der
 * App, und stehen nicht hier.
 */
export const EINGEFUEHRTE_KUERZEL: readonly { kuerzel: string; bedeutung: string }[] = [
  { kuerzel: 'BR', bedeutung: 'Bereitstellungsraum' },
  { kuerzel: 'Einh.', bedeutung: 'Einheiten' },
  { kuerzel: 'ETB', bedeutung: 'Einsatztagebuch' },
  { kuerzel: 'F/UF/M//Σ', bedeutung: 'Führer / Unterführer / Mannschaft // Summe (Stärke)' },
  { kuerzel: 'FMS, S1–S9', bedeutung: 'Funkmeldesystem und seine Status 1 bis 9' },
  { kuerzel: 'Fzg.', bedeutung: 'Fahrzeuge' },
  { kuerzel: 'Pers.', bedeutung: 'Personen' },
  { kuerzel: 'Rückm.', bedeutung: 'Rückmeldung' },
  { kuerzel: 'SK I–IV', bedeutung: 'Sichtungskategorie I bis IV' },
  { kuerzel: 'UHS', bedeutung: 'Unfallhilfsstelle' },
];
