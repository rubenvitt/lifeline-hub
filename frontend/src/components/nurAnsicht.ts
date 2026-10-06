import type { EinsatzStatus } from '../api/types';

/**
 * Gründe der Zeile „Nur Ansicht · Grund“ (`RechteHinweis`, LFH-1078, Spec `bedien-erklaertexte`).
 *
 * Wenige Wörter, kein Satz: was fehlt, sieht man an den gesperrten Knöpfen; der Grund muss nur
 * ohne Hover lesbar sein. Kein „die Werte stehen hier zum Nachlesen“ — das zeigt die Seite selbst.
 */
export const NUR_ADMIN = 'nur System-Admin';
export const NUR_LEITUNG_FUEHRUNG = 'nur Einsatzleitung und Führung';
export const NUR_LEITUNG_FUEHRUNG_ADMIN = 'nur Einsatzleitung, Führung oder Admin';
export const NUR_LEITUNG_ADMIN = 'nur Einsatzleitung oder Admin';
export const EINSATZ_ABGESCHLOSSEN = 'Einsatz abgeschlossen';

/** Grund für Module, in denen Einsatzleitung und Führungspersonal schreiben. */
export function einsatzRechteGrund(einsatzStatus: EinsatzStatus): string {
  return einsatzStatus !== 'aktiv' ? EINSATZ_ABGESCHLOSSEN : NUR_LEITUNG_FUEHRUNG;
}
