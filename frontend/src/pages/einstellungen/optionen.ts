import type { EinheitenSystem, Koordinatenformat, Zeitformat } from '../../api/types';

/**
 * Auswahllisten der Einstellungsseiten (LFH-328 · A2).
 *
 * Zusammengezogen aus `EinsatzEinstellungenPage` und `einstellungen/AnzeigeEinstellungen`,
 * wo sie **byte-identisch** doppelt standen — es gab keine subtile Wertabweichung, die
 * beim Zusammenziehen hätte verlorengehen können.
 *
 * **Was hier bewusst NICHT hinwandert:** der Platzhalter der Selects. Die Einsatzseite
 * sagt „(Standard)", die Org-Seite „(Fallback)" — die eine ERBT von der Organisation,
 * die andere IST die Organisationsebene. Der Platzhalter bleibt deshalb an der
 * Aufrufstelle.
 *
 * **Dritte Kopie, absichtlich stehengelassen:** `command-palette/befehle.ts`
 * (`KOORD_BEFEHLE`) trägt dieselben fünf Koordinatenwerte mit anderen Labels
 * („WGS84 (Dezimalgrad)" statt „WGS84 dezimal"). Die sind für den Palettenkontext
 * geschrieben; die Zusammenführung ist als eigener Befund erfasst (Spec §5).
 */

/** Benötigte Rolle eines Moduls; '' = frei (für alle sichtbaren). */
export const ROLLEN_OPTIONEN: { value: string; label: string }[] = [
  { value: '', label: 'Frei (alle)' },
  { value: 'fuehrungskraft', label: 'Führungskraft' },
  { value: 'admin', label: 'Admin' },
];

/** Kuratierte IANA-Zeitzonen; Freitext bleibt über die `AutoComplete` möglich. */
export const ZEITZONEN_OPTIONEN = [
  'Europe/Berlin',
  'Europe/London',
  'Europe/Paris',
  'Europe/Zurich',
  'Europe/Vienna',
  'Europe/Warsaw',
  'Europe/Moscow',
  'UTC',
  'America/New_York',
  'America/Los_Angeles',
  'Asia/Istanbul',
  'Asia/Dubai',
  'Asia/Tokyo',
].map((z) => ({ value: z }));

export const ZEITFORMAT_OPTIONEN: { value: Zeitformat; label: string }[] = [
  { value: '24h', label: '24 Stunden' },
  { value: '12h', label: '12 Stunden (AM/PM)' },
];

export const EINHEITEN_OPTIONEN: { value: EinheitenSystem; label: string }[] = [
  { value: 'metrisch', label: 'Metrisch (m, km)' },
  { value: 'imperial', label: 'Imperial (ft, mi)' },
];

export const KOORDINATEN_OPTIONEN: { value: Koordinatenformat; label: string }[] = [
  { value: 'wgs84', label: 'WGS84 dezimal' },
  { value: 'dms', label: 'WGS84 (Grad/Min/Sek)' },
  { value: 'utm', label: 'UTM' },
  { value: 'mgrs', label: 'MGRS' },
  { value: 'gk', label: 'Gauß-Krüger' },
];
