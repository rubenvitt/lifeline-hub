import type {
  BenoetigteRolle,
  EinheitenSystem,
  Koordinatenformat,
  Zeitformat,
} from '../../api/types';

/**
 * Auswahllisten der Einstellungsseiten. Der Platzhalter der Selects bleibt an der Aufrufstelle und
 * nennt den System-Wert mit „(Vorgabe)“ (`components/vorgabeText.ts`, LFH-944).
 * `command-palette/befehle.ts` (`KOORD_BEFEHLE`) trägt dieselben Koordinatenwerte mit eigenen
 * Labels für den Palettenkontext.
 */

/**
 * Benötigte Rolle eines Moduls, von offen nach eng; '' = frei (für alle sichtbaren). „Führung im
 * Einsatz“ zählt die Rolle im Einsatz mit, „Führungskraft der Organisation“ nur die Org-Rolle
 * (Spec `modul-freigabe`, LFH-1150).
 */
export const ROLLEN_OPTIONEN: { value: BenoetigteRolle | ''; label: string }[] = [
  { value: '', label: 'Frei (alle)' },
  { value: 'einsatzfuehrung', label: 'Führung im Einsatz' },
  { value: 'fuehrungskraft', label: 'Führungskraft der Organisation' },
  { value: 'admin', label: 'Admin' },
];

/** Der Name einer gesetzten Stufe aus `ROLLEN_OPTIONEN`; `undefined` für frei oder unbekannt. */
export function rollenName(rolle: string | null | undefined): string | undefined {
  if (!rolle) return undefined;
  return ROLLEN_OPTIONEN.find((o) => o.value === rolle)?.label;
}

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
