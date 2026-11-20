import type { EinsatzAnzeige, EinsatzSpiegelAnzeige, EinsatzStatus } from '../api/types';
import { istMitarbeit } from '../einsatz/schreibrecht';
import { EINSATZ_ROLLE, SYSTEM_ADMIN_DER_ORG } from '../einsatz/rollenVokabular';

const LEITUNG = EINSATZ_ROLLE.einsatzleitung.name;
const FUEHRUNG = EINSATZ_ROLLE.fuehrungspersonal.name;
const MITARBEIT = EINSATZ_ROLLE.mitarbeit.name;

/**
 * Gründe der Zeile „Nur Ansicht · Grund“ (`RechteHinweis`, LFH-1078; `frontend/AGENTS.md`,
 * Bedien-Leitlinie „Texte: zeigen statt erklären“).
 *
 * Wenige Wörter, kein Satz: was fehlt, sieht man an den gesperrten Knöpfen; der Grund muss nur
 * ohne Hover lesbar sein. Kein „die Werte stehen hier zum Nachlesen“ — das zeigt die Seite selbst.
 *
 * Rollen heißen wie im Rollen-Vokabular (LLH-1818, `einsatz/rollenVokabular.ts`; „Führungspersonal“,
 * nicht „Führung“): wer etwa Führungskraft der Organisation und im Einsatz Beobachter ist, darf
 * sich nicht gemeint fühlen.
 */
// `NUR_ADMIN` steht beim Rollen-Vokabular, weil `stammdaten/rechteText.ts` ihn braucht und die
// e2e-Specs jenes Modul in Node laden: über dieses hier (`einsatz/schreibrecht`) kämen dayjs-Plugins
// ohne `.js` mit, die Node nicht auflöst (alpha rot am 20.11.2026, die e2e-Suite lud keine Spec).
export { NUR_ADMIN } from '../einsatz/rollenVokabular';
/** Aktionen, die nur die Einsatzleitung ausführt. */
export const NUR_LEITUNG = `nur ${LEITUNG}`;
export const NUR_LEITUNG_FUEHRUNG = `nur ${LEITUNG} und ${FUEHRUNG}`;
/** Erfassen in Chat und ETB (LLH-1817): dort erfasst auch die Mitarbeit. */
export const NUR_LEITUNG_FUEHRUNG_MITARBEIT = `nur ${LEITUNG}, ${FUEHRUNG} und ${MITARBEIT}`;
/** Kopfdaten, Einstellungen und Führungsstelle (LFH-1066): der Admin nur der Org des Einsatzes. */
export const NUR_LEITUNG_FUEHRUNG_ORG_ADMIN = `nur ${LEITUNG}, ${FUEHRUNG} oder ${SYSTEM_ADMIN_DER_ORG}`;
/** Fristen ändert nur der Admin der Org, der der Einsatz gehört (LFH-753) — nicht jeder Admin. */
export const NUR_LEITUNG_ORG_ADMIN = `nur ${LEITUNG} oder ${SYSTEM_ADMIN_DER_ORG}`;
export const EINSATZ_ABGESCHLOSSEN = 'Einsatz abgeschlossen';
/** Mitarbeit (LLH-1817) erfasst, ändert sonst nichts: der Grund an jeder Fläche, die sie sperrt. */
export const NUR_ERFASSEN = `als ${MITARBEIT} nur erfassen`;
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
/** Lagemeldung erfassen (LLH-1031): jede Lagemeldung ist eine Meldung, das Modul Meldungen schreibt sie. */
export const MODUL_MELDUNGEN_GESPERRT = 'Modul Meldungen gesperrt';
/** Verbleib im Bereitstellungsraum nach dem Vollzug einer Ablösung (LLH-1308). */
export const MODUL_BR_GESPERRT = 'Modul Bereitstellungsräume gesperrt';

/**
 * Grund für eine Fläche, der mehrere Quellen fehlen können (LLH-1462, Meldebild): „Modul Personal
 * gesperrt“, „Module Personal und Fahrzeuge gesperrt“. `null` ohne gesperrtes Modul. Die Namen
 * kommen vom Aufrufer im Wortlaut der Konstanten oben.
 */
export function modulSperre(namen: readonly string[]): string | null {
  if (namen.length === 0) return null;
  if (namen.length === 1) return `Modul ${namen[0]} gesperrt`;
  return `Module ${namen.slice(0, -1).join(', ')} und ${namen[namen.length - 1]} gesperrt`;
}

/**
 * Ein Spiegel (LLH-1492, Spec `einsatz-spiegel`): die führende Instanz nennt der Grund, wie das
 * Hinweisband. Ändern geht dort; hier nur die beantragbaren Erfassungen. Ein eingespieltes Archiv
 * (LLH-1494) heißt wie im Band.
 */
export function spiegelGrund(
  spiegel: Pick<EinsatzSpiegelAnzeige, 'gegenstelle' | 'archiv_bis'>,
): string {
  return spiegel.archiv_bis ? 'Aus dem Archiv' : `Spiegel von ${spiegel.gegenstelle}`;
}

/**
 * Grund für Module, in denen Einsatzleitung und Führungspersonal schreiben. Mit dem Einsatz statt
 * nur seinem Status nennt er am Spiegel die führende Instanz (LLH-1492; führt eine gekoppelte
 * Instanz, ist der Einsatz hier ein Spiegel, LLH-1641); sonst abgeschlossen, sonst die Rollen.
 * `rollen` nennt sie für Flächen mit anderem Recht, etwa die Einsatz-Einstellungen (LLH-1675).
 */
export function einsatzRechteGrund(
  einsatz:
    | EinsatzStatus
    | (Pick<EinsatzAnzeige, 'status' | 'spiegel'> & Partial<Pick<EinsatzAnzeige, 'meine_rolle'>>),
  rollen: string = NUR_LEITUNG_FUEHRUNG,
): string {
  if (typeof einsatz !== 'string' && einsatz.spiegel != null) {
    return spiegelGrund(einsatz.spiegel);
  }
  const status = typeof einsatz === 'string' ? einsatz : einsatz.status;
  if (status !== 'aktiv') return EINSATZ_ABGESCHLOSSEN;
  if (typeof einsatz !== 'string' && istMitarbeit(einsatz)) return NUR_ERFASSEN;
  return rollen;
}
