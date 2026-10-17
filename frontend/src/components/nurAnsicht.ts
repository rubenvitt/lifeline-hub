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
/** Freigaben, die nur die Einsatzleitung erteilt (etwa einer Pressemitteilung, LFH-554). */
export const NUR_LEITUNG = 'nur Einsatzleitung';
export const NUR_LEITUNG_FUEHRUNG = 'nur Einsatzleitung und Führungspersonal';
/** Kopfdaten, Einstellungen und Führungsstelle (LFH-1066): der Admin nur der Org des Einsatzes. */
export const NUR_LEITUNG_FUEHRUNG_ORG_ADMIN = 'nur Einsatzleitung, Führungspersonal oder Org-Admin';
/** Fristen ändert nur der Admin der Org, der der Einsatz gehört (LFH-753) — nicht jeder Admin. */
export const NUR_LEITUNG_ORG_ADMIN = 'nur Einsatzleitung oder Org-Admin';
export const EINSATZ_ABGESCHLOSSEN = 'Einsatz abgeschlossen';
/**
 * Ein Modul, dessen Freigabe der Person fehlt, an dem Ort, der es braucht (LLH-1036, Einheit-Ansicht
 * D5/D11): die Besatzung braucht Personal und Fahrzeuge, die Zuordnung ihr Zielmodul.
 */
export const MODUL_PERSONAL_GESPERRT = 'Modul Personal gesperrt';
export const MODUL_FAHRZEUGE_GESPERRT = 'Modul Fahrzeuge gesperrt';
export const MODUL_MATERIAL_GESPERRT = 'Modul Material gesperrt';
export const MODULE_PERSONAL_FAHRZEUGE_GESPERRT = 'Module Personal und Fahrzeuge gesperrt';
/** Abruf aus dem Bereitstellungsraum (LLH-1085): der Ziel-Abschnitt setzt die Unterstellung, der
 *  Auftragstext erteilt einen Auftrag; die Liste der Abschnitte liest das Modul Einsatzabschnitte.
 *  „Ohne Schicht“ der Ablösung liest Einheiten und ihre Zeitachse (LLH-1128). */
export const MODUL_EINHEITEN_GESPERRT = 'Modul Einheiten gesperrt';
export const MODUL_ABSCHNITTE_GESPERRT = 'Modul Einsatzabschnitte gesperrt';
export const MODUL_AUFTRAEGE_GESPERRT = 'Modul Aufträge gesperrt';

/** Grund für Module, in denen Einsatzleitung und Führungspersonal schreiben. */
export function einsatzRechteGrund(einsatzStatus: EinsatzStatus): string {
  return einsatzStatus !== 'aktiv' ? EINSATZ_ABGESCHLOSSEN : NUR_LEITUNG_FUEHRUNG;
}
