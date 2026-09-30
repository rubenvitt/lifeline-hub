import type { EinsatzStatus } from '../api/types';

/**
 * Wortlaut der fehlenden Berechtigung auf den S5-Seiten (LFH-554, M16): gesperrt bleibt
 * sichtbar, und der Satz nennt den Grund.
 */
export function presseRechteText(einsatzStatus: EinsatzStatus): string {
  return einsatzStatus !== 'aktiv'
    ? 'Der Einsatz ist abgeschlossen — Presse-Log und Pressemitteilungen sind nur noch lesbar.'
    : 'Nur Einsatzleitung und Führungspersonal können Medienkontakte erfassen und Pressemitteilungen schreiben.';
}

export function infotelefonRechteText(einsatzStatus: EinsatzStatus): string {
  return einsatzStatus !== 'aktiv'
    ? 'Der Einsatz ist abgeschlossen — das Anrufprotokoll ist nur noch lesbar.'
    : 'Nur Einsatzleitung und Führungspersonal können Anrufe erfassen.';
}

/** Grund an der gesperrten Freigabe einer Pressemitteilung. */
export const FREIGABE_NUR_LEITUNG =
  'Freigeben darf nur die Einsatzleitung. Entwürfe können Einsatzleitung und Führungspersonal schreiben.';
