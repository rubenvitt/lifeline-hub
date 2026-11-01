/**
 * „Ist dieser Eintrag überholt?“ — EINE Stelle für alle Ansichten, die ETB-Einträge listen
 * (LLH-1099, LLH-1321): ETB-Zeitachse, Lage-Dashboard, Überblick, Lageentwicklung. Gelesen wird
 * das Wire-Feld `berichtigt_durch`; der Server liefert es unabhängig von Seite und Filter (Spec
 * `etb-berichtigung`, LFH-689). Rein.
 */
import type { EtbEintragAnzeige } from '../api/types';

export type BerichtigungVerweis = EtbEintragAnzeige['berichtigt_durch'][number];

/** Was von einem Eintrag gebraucht wird. Fehlt das Feld (Gerätespeicher von vor LFH-689): keine. */
export type MitBerichtigungen = Partial<Pick<EtbEintragAnzeige, 'berichtigt_durch'>>;

/** Die Berichtigungen eines Eintrags, jüngste zuerst. */
export function berichtigtDurch(e: MitBerichtigungen): BerichtigungVerweis[] {
  return [...(e.berichtigt_durch ?? [])].sort((a, b) => b.lfd_nr - a.lfd_nr);
}

/** Die jüngste Berichtigung — das Sprungziel der Marke „berichtigt“ —, sonst `undefined`. */
export function juengsteBerichtigung(e: MitBerichtigungen): BerichtigungVerweis | undefined {
  return berichtigtDurch(e)[0];
}

/**
 * Dieselbe Kennzeichnung als Klartext, für Übernahmen in ein Dokument (Lageentwicklung): dort
 * gibt es keine Marke und keinen Sprung, nur die Nummer. Ohne Berichtigung `null`.
 */
export function berichtigtText(e: MitBerichtigungen): string | null {
  const juengste = juengsteBerichtigung(e);
  return juengste ? `berichtigt → Nr. ${juengste.lfd_nr}` : null;
}
