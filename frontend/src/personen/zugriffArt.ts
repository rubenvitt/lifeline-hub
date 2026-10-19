import type { PersonZugriff, PersonZugriffArt } from '../api/types';

/**
 * Klartext je Art im Zugriffsprotokoll einer Person (Audit-Einsicht der Einsatzleitung). Der
 * `Record` über die generierte Union ist erschöpfend: eine neue Art am Server (Enum `ZugriffArt`,
 * CHECK in `person_zugriff_audit`) bricht hier `tsc`, statt als Rohwert in der Tabelle zu stehen.
 */
export const ZUGRIFF_ART_TEXT: Record<PersonZugriffArt, string> = {
  detail: 'Detail geöffnet',
  export: 'Liste exportiert',
  druck: 'Liste gedruckt',
  // LFH-757: Abruf der Datei eines Personen-Anhangs (auch aus dem Browser-Cache und das Original).
  anhang: 'Datei geladen',
};

/**
 * Klartext einer Zeile. `druck` steht für zwei Zugriffe, die nur `person_id` trennt: der Druck der
 * Liste trägt keine, die Druckansicht einer Person (LLH-1120, `…/personen/{pid}/druck`) ihre.
 */
export function zugriffArtText(zugriff: Pick<PersonZugriff, 'art' | 'person_id'>): string {
  if (zugriff.art === 'druck' && zugriff.person_id != null) return 'Blatt gedruckt';
  return ZUGRIFF_ART_TEXT[zugriff.art];
}
