import type { ModulFreigaben } from '../../api/types';
import { istModulGesperrt, istModulSichtbar, type ModulEintrag } from '../../einsatz/modulRegistry';

/**
 * Zugriff auf die Ebene „Betroffene" der Lagekarte — rein, damit die Zustände ohne Rendern prüfbar
 * sind.
 *
 * Die Grenze sitzt an der Datenquelle, nicht am Schalter: die Kartenansicht ist einsatzweit
 * geteilt, eine Ansicht mit eingeschalteter Ebene kommt auch bei Benutzern ohne das Modul
 * „Personen" an. Gezeichnet wird nur bei `'frei'`; der Schalter wird nicht zurückgeschrieben, sonst
 * überschriebe ein Benutzer ohne Recht beim Speichern die Wahl der Führungskraft.
 *
 * - `'ausgeblendet'`: Modul im Einsatz unsichtbar, nicht fertig, oder die Freigaben des Servers
 *   stehen noch nicht fest (Laden, Fehler). Keine Zeile und kein Request.
 * - `'gesperrt'`: der Server verweigert das Modul (`zugriff: false` in den Freigaben, LFH-669),
 *   oder die Liste kam trotzdem mit 403 — das Netz für eine Freigabe, die seit dem Abruf veraltet
 *   ist. Kein Ausfall einer Lagebild-Quelle.
 * - `'rueckblick'`: Historien-Modus. Gesicherte Lagestände tragen keine Personen.
 * - `'frei'`: laden und — bei eingeschaltetem Schalter — zeichnen.
 */
export type PersonenZugriff = 'frei' | 'gesperrt' | 'ausgeblendet' | 'rueckblick';

export function personenZugriffVon(a: {
  istSnapshot: boolean;
  modul: ModulEintrag | undefined;
  /** Freigaben des Servers; `undefined`, solange sie laden oder ihr Abruf gescheitert ist. */
  freigaben: ModulFreigaben | undefined;
  /** Die Personenliste kam mit 403 zurück. */
  abgelehnt: boolean;
}): PersonenZugriff {
  if (!a.freigaben || !a.modul) return 'ausgeblendet';
  if (a.modul.status !== 'fertig' || !istModulSichtbar(a.modul, a.freigaben)) {
    return 'ausgeblendet';
  }
  if (istModulGesperrt(a.modul, a.freigaben)) return 'gesperrt';
  // Rückblick erst nach Sichtbarkeit und Rolle: ein ausgeblendetes Modul zeigt auch im
  // Historien-Modus keine Zeile.
  if (a.istSnapshot) return 'rueckblick';
  if (a.abgelehnt) return 'gesperrt';
  return 'frei';
}

/** Sichtbarer Grund an einer gesperrten Ebenen-Zeile — genau dort, wo keine Zahl steht. */
export const PERSONEN_SPERRGRUND: Record<'gesperrt' | 'rueckblick', string> = {
  gesperrt: 'Keine Berechtigung',
  rueckblick: 'Nicht in gesicherten Lageständen',
};
