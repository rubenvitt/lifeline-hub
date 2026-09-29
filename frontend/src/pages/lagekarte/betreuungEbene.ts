import type { BenutzerAnzeige, ModulOverrides } from '../../api/types';
import type { ModulEintrag } from '../../einsatz/modulRegistry';
import { personenZugriffVon, type PersonenZugriff } from './personenEbene';

/**
 * Zugriff auf die Ebene „Betreuungsstellen" — dieselbe Grenze wie „Betroffene"
 * (`personenEbene.ts`): sie sitzt an der Datenquelle, nicht am Schalter, und ein 403 ist
 * „gesperrt", kein Ausfall einer Lagebild-Quelle.
 *
 * Eine eigene Funktion, weil gesicherte Lagestände die Betreuungsstellen tragen (der Server lässt
 * sie für Personen ohne Modulrecht weg): `'rueckblick'` ist hier kein Zustand.
 */
export type BetreuungZugriff = Exclude<PersonenZugriff, 'rueckblick'>;

export function betreuungZugriffVon(a: {
  /** Overrides-Abfrage ist abgeschlossen (Erfolg ODER Fehler — dann gilt der Registry-Default). */
  rechteBekannt: boolean;
  modul: ModulEintrag | undefined;
  benutzer: BenutzerAnzeige | null;
  overrides: ModulOverrides | undefined;
  /** Die Betreuungs-Übersicht kam mit 403 zurück. */
  abgelehnt: boolean;
}): BetreuungZugriff {
  // `istSnapshot: false` schließt `'rueckblick'` aus — der Cast ist damit keine Behauptung.
  return personenZugriffVon({ ...a, istSnapshot: false }) as BetreuungZugriff;
}

/** Sichtbarer Grund an der gesperrten Zeile — derselbe Wortlaut wie bei „Betroffene". */
export const BETREUUNG_SPERRGRUND = 'Keine Berechtigung';
