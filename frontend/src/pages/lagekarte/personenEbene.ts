import type { BenutzerAnzeige, ModulOverrides } from '../../api/types';
import { istModulGesperrt, istModulSichtbar, type ModulEintrag } from '../../einsatz/modulRegistry';

/**
 * Zugriff auf die Ebene „Betroffene" der Lagekarte (LFH-648) — rein, damit die Zustände ohne
 * Rendern prüfbar sind.
 *
 * Die Zugriffsgrenze sitzt an der DATENquelle, nicht am Ebenen-Schalter: die Kartenansicht ist
 * einsatzweit geteilt, eine von der Führungskraft gespeicherte Ansicht mit eingeschalteter
 * Ebene kommt also auch bei einem Benutzer ohne das Modul „Personen" an. Gezeichnet wird nur
 * bei `'frei'`; der Schalter wird für die übrigen Zustände NICHT zurückgeschrieben — sonst
 * überschriebe ein Benutzer ohne Recht beim Speichern die Wahl der Führungskraft.
 *
 * - `'ausgeblendet'`: Modul im Einsatz unsichtbar, nicht fertig, oder die Overrides stehen noch
 *   nicht fest. Keine Zeile — wie in der Einsatz-Navigation, die ein verstecktes Modul gar
 *   nicht rendert. Solange die Rechte offen sind, gibt es auch keinen Request: in der
 *   Ladelücke sagte der Registry-Default „frei", der Einsatz aber womöglich „ausgeblendet".
 * - `'gesperrt'`: Rollen-Schranke im Client ODER der Server lehnt mit 403 ab. Letzteres ist der
 *   Fall, den der Client nicht sieht — `istModulGesperrt` kennt die Org-Defaults nicht, das
 *   Backend schon. Beides ist „Keine Berechtigung", kein Ausfall einer Lagebild-Quelle. Die strukturelle
 *   Lösung (eine effektive Freigabe vom Server) ist LFH-669.
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
  // Rückblick erst NACH Sichtbarkeit und Rolle: ein im Einsatz ausgeblendetes Modul zeigt
  // auch im Historien-Modus keine Zeile (Review-Befund LFH-648).
  if (a.istSnapshot) return 'rueckblick';
  if (a.abgelehnt) return 'gesperrt';
  return 'frei';
}

/** Sichtbarer Grund an einer gesperrten Ebenen-Zeile — genau dort, wo keine Zahl steht. */
export const PERSONEN_SPERRGRUND: Record<'gesperrt' | 'rueckblick', string> = {
  gesperrt: 'Keine Berechtigung',
  rueckblick: 'Nicht in gesicherten Lageständen',
};
