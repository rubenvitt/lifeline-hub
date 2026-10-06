import type { EinsatzStatus } from '../api/types';

/**
 * Gründe der Zeile „Nur Ansicht · Grund“ (`RechteHinweis`, LFH-1078; `frontend/AGENTS.md`,
 * Bedien-Leitlinie „Texte: zeigen statt erklären“).
 *
 * Wenige Wörter, kein Satz: was fehlt, sieht man an den gesperrten Knöpfen; der Grund muss nur
 * ohne Hover lesbar sein. Kein „die Werte stehen hier zum Nachlesen“ — das zeigt die Seite selbst.
 *
 * Rollen heißen wie in der Mitgliederverwaltung („Führungspersonal“, nicht „Führung“): wer etwa
 * die Systemrolle Führungskraft hat und im Einsatz Beobachter ist, darf sich nicht gemeint fühlen.
 */
export const NUR_ADMIN = 'nur System-Admin';
export const NUR_LEITUNG_FUEHRUNG = 'nur Einsatzleitung und Führungspersonal';
export const NUR_LEITUNG_FUEHRUNG_ADMIN = 'nur Einsatzleitung, Führungspersonal oder Admin';
/** Fristen ändert nur der Admin der Org, der der Einsatz gehört (LFH-753) — nicht jeder Admin. */
export const NUR_LEITUNG_ORG_ADMIN = 'nur Einsatzleitung oder Org-Admin';
export const EINSATZ_ABGESCHLOSSEN = 'Einsatz abgeschlossen';

/** Grund für Module, in denen Einsatzleitung und Führungspersonal schreiben. */
export function einsatzRechteGrund(einsatzStatus: EinsatzStatus): string {
  return einsatzStatus !== 'aktiv' ? EINSATZ_ABGESCHLOSSEN : NUR_LEITUNG_FUEHRUNG;
}
