import type { PersonZugriffArt } from '../api/types';

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

export function zugriffArtText(art: PersonZugriffArt): string {
  return ZUGRIFF_ART_TEXT[art];
}
