import type { BenutzerAnzeige, ModulOverrides } from '../../api/types';
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
 * - `'ausgeblendet'`: Modul im Einsatz unsichtbar, nicht fertig, oder die Overrides stehen noch
 *   nicht fest. Keine Zeile und kein Request (in der Ladelücke sagte der Registry-Default „frei").
 * - `'gesperrt'`: Rollen-Schranke im Client oder 403 vom Server (`istModulGesperrt` kennt die
 *   Org-Defaults nicht, das Backend schon). Kein Ausfall einer Lagebild-Quelle. Strukturelle
 *   Lösung: LFH-669.
 * - `'rueckblick'`: Historien-Modus. Gesicherte Lagestände tragen keine Personen.
 * - `'frei'`: laden und — bei eingeschaltetem Schalter — zeichnen.
 */
export type PersonenZugriff = 'frei' | 'gesperrt' | 'ausgeblendet' | 'rueckblick';

export function personenZugriffVon(a: {
  istSnapshot: boolean;
  /** Overrides-Abfrage ist abgeschlossen (Erfolg ODER Fehler — dann gilt der Registry-Default). */
  rechteBekannt: boolean;
  modul: ModulEintrag | undefined;
  benutzer: BenutzerAnzeige | null;
  overrides: ModulOverrides | undefined;
  /** Die Personenliste kam mit 403 zurück. */
  abgelehnt: boolean;
}): PersonenZugriff {
  if (!a.rechteBekannt || !a.modul) return 'ausgeblendet';
  if (a.modul.status !== 'fertig' || !istModulSichtbar(a.modul, a.overrides)) {
    return 'ausgeblendet';
  }
  if (istModulGesperrt(a.modul, a.benutzer, a.overrides)) return 'gesperrt';
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
