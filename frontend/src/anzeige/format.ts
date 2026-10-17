/**
 * Reine Formatlogik für Anzeige-Konventionen: Zeit (Zeitzone + 24h/12h), Koordinaten
 * (WGS84/MGRS/UTM/GK) und Einheiten (metrisch/imperial). Provider/Hook delegieren hierher.
 */
import dayjs, { type Dayjs } from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import type { EinheitenSystem, Koordinatenformat, Zeitformat } from '../api/types';
import { formatiere } from './koordinaten';

dayjs.extend(utc);
dayjs.extend(timezone);

export interface AnzeigeKonventionen {
  zeitzone?: string | null;
  zeitformat?: Zeitformat | null;
  einheiten?: EinheitenSystem | null;
  koordinatenformat?: Koordinatenformat | null;
}

/**
 * Default: alles null → lokal, 24h, dezimal, metrisch.
 *
 * Die Zeitformatierer unten nehmen ihn NICHT als Vorgabe, die Konventionen sind dort Pflicht
 * (LFH-913): ein Aufruf ohne Konventionen formatierte still in der Browserzone, auch unter dem
 * `EinsatzAnzeigeProvider`. Der Typprüfer findet so jede vergessene Stelle; in Komponenten die
 * gebundenen Formatierer aus `useAnzeigeKonventionen()` oder `ZeitAnzeige`. Wer bewusst die
 * Browserzone will, übergibt `DEFAULT_KONVENTIONEN` ausdrücklich.
 */
export const DEFAULT_KONVENTIONEN: AnzeigeKonventionen = {
  zeitzone: null,
  zeitformat: null,
  einheiten: null,
  koordinatenformat: null,
};

/**
 * UTC-Wirestring → dayjs in der gewünschten Zeitzone (sonst lokal).
 * `d.tz(zone)` wirft bei ungültiger IANA-Zone; das Feld ist Freitext, ein Tippfehler ließe sonst
 * jedes Zeit-Rendering crashen — deshalb Fallback auf lokale Zeit.
 */
export function inZone(utcStr: string, konv: AnzeigeKonventionen) {
  const d = dayjs.utc(utcStr);
  if (!konv.zeitzone) return d.local();
  try {
    return d.tz(konv.zeitzone);
  } catch {
    return d.local();
  }
}

/**
 * Deutsche Monats-Großkürzel für die taktische DTG; dayjs' `MMM` liefert nie großgeschrieben
 * ohne Punkt.
 */
const MONATE_DE = [
  'JAN',
  'FEB',
  'MÄR',
  'APR',
  'MAI',
  'JUN',
  'JUL',
  'AUG',
  'SEP',
  'OKT',
  'NOV',
  'DEZ',
];

/** Taktische Uhrzeit „1430". BOS-Konvention ist 24h; das 12h/24h-Setting gilt hier nicht. */
export function taktischeUhrzeit(
  utcStr: string | null | undefined,
  konv: AnzeigeKonventionen,
): string {
  if (!utcStr) return '';
  return inZone(utcStr, konv).format('HHmm');
}

/** Taktische Datum-Zeit-Gruppe kurz „161430" (Tag + Uhrzeit, ohne Monat/Jahr). */
export function taktischeDtg(utcStr: string | null | undefined, konv: AnzeigeKonventionen): string {
  if (!utcStr) return '';
  return inZone(utcStr, konv).format('DDHHmm');
}

/** Volle taktische DTG „161430JUL2026" (Tag + Uhrzeit + dt. Monatskürzel + Jahr). */
export function taktischeDtgVoll(
  utcStr: string | null | undefined,
  konv: AnzeigeKonventionen,
): string {
  if (!utcStr) return '';
  const d = inZone(utcStr, konv);
  return `${d.format('DDHHmm')}${MONATE_DE[d.month()]}${d.format('YYYY')}`;
}

/**
 * Monatskürzel der Datum-Zeit-Gruppe nach FwDV/DV 810 (Ausgabe 2018, Sprech- und
 * Datenfunkverkehr: „Tag des Monats – Uhrzeitgruppe (hhmm), soweit erforderlich können Monat und
 * Jahr angefügt werden“, Beispiel „271938jan19“): klein, drei Buchstaben, ohne Umlaut.
 * Entscheidung E1 vom 17.10.2026 (LLH-1045). Der Zeit-Parser liest dieselbe Tabelle.
 */
export const MONATE_DTG = [
  'jan',
  'feb',
  'mrz',
  'apr',
  'mai',
  'jun',
  'jul',
  'aug',
  'sep',
  'okt',
  'nov',
  'dez',
] as const;

/**
 * Volle DTG nach E1 „161430okt26“ (Tag, Uhrzeit, Monat klein, Jahr zweistellig) eines
 * Zeitpunkts in der Anzeigezone; ohne gültige Zone in der Browserzone. Das Zeitfeld zeigt seinen
 * Wert so (Spec `zeiteingabe`, „Anzeige im Feld als Datum-Zeit-Gruppe“). Die übrigen Anzeigen
 * stellt LLH-1053 von {@link taktischeDtgVoll} hierher um.
 */
export function formatDtg(zeitpunkt: Dayjs, zone: string | null | undefined): string {
  const d = inZone(zeitpunkt.utc().format('YYYY-MM-DD HH:mm:ss'), { zeitzone: zone });
  return `${d.format('DDHHmm')}${MONATE_DTG[d.month()]}${d.format('YY')}`;
}

/** Volle Zeitangabe → taktische DTG „161430JUL2026". */
export function formatZeit(utcStr: string | null | undefined, konv: AnzeigeKonventionen): string {
  return taktischeDtgVoll(utcStr, konv);
}

/** Kurze Zeitangabe → taktische Uhrzeit „1430" wenn heute, sonst kurze DTG „161430". */
export function formatZeitKurz(
  utcStr: string | null | undefined,
  konv: AnzeigeKonventionen,
): string {
  if (!utcStr) return '';
  const d = inZone(utcStr, konv);
  // „Heute" muss in derselben Zeitzone bestimmt werden, sonst kippt die Tagesgrenze.
  const jetzt = konv.zeitzone ? dayjs().tz(konv.zeitzone) : dayjs();
  return d.isSame(jetzt, 'day') ? d.format('HHmm') : d.format('DDHHmm');
}

/**
 * Reine Uhrzeit `HH:mm` in der Anzeigezone — für Instrumente, die den Tag aus dem Zusammenhang
 * kennen. Der Leerwert `——:——` hat Ziffernbreite, damit eine Lücke in einer Instrumentenspalte
 * die Nachbarzeilen nicht verschiebt.
 */
export function formatUhrzeit(
  utcStr: string | null | undefined,
  konv: AnzeigeKonventionen,
): string {
  if (!utcStr) return '——:——';
  return inZone(utcStr, konv).format('HH:mm');
}

/**
 * Tagesbewusste Uhrzeit `HH:mm` (heute) bzw. `DD. HH:mm` (sonst) — für Fristen, bei denen
 * „in 20 Minuten" sonst nicht von „morgen früh" zu unterscheiden wäre. „Heute" in DERSELBEN
 * Zeitzone wie die Formatierung.
 */
export function formatUhrzeitMitTag(
  utcStr: string | null | undefined,
  konv: AnzeigeKonventionen,
): string {
  if (!utcStr) return '——:——';
  const d = inZone(utcStr, konv);
  const jetzt = konv.zeitzone ? dayjs().tz(konv.zeitzone) : dayjs();
  return d.isSame(jetzt, 'day') ? d.format('HH:mm') : d.format('DD. HH:mm');
}

/**
 * Das wirksame Koordinatenformat: Anwender-Override vor Einsatz-Einstellung vor Org-Default.
 * Drei Primitive statt des Einstellungsobjekts, damit ein `useMemo` des Aufrufers stabil bleibt.
 * Eine Stelle auch für die Sprungpalette, die außerhalb des `EinsatzAnzeigeProvider` hängt.
 */
export function effektivesKoordinatenformat(
  override: Koordinatenformat | null,
  einsatz: Koordinatenformat | null | undefined,
  orgDefault: Koordinatenformat | null | undefined,
): Koordinatenformat | null {
  return override ?? einsatz ?? orgDefault ?? null;
}

/** WGS84-Koordinate → Anzeige-String je Koordinatenformat (Default: dezimal). */
export function formatKoordinate(
  lat: number,
  lon: number,
  konv: AnzeigeKonventionen = DEFAULT_KONVENTIONEN,
): string {
  return formatiere(lat, lon, konv.koordinatenformat ?? 'wgs84');
}

/** Distanz in Metern → Anzeige-String je Einheiten-System (Default: metrisch). */
export function formatDistanz(
  meter: number,
  konv: AnzeigeKonventionen = DEFAULT_KONVENTIONEN,
): string {
  if (konv.einheiten === 'imperial') {
    const feet = meter * 3.28084;
    return feet >= 5280 ? `${(feet / 5280).toFixed(2)} mi` : `${Math.round(feet)} ft`;
  }
  return meter >= 1000 ? `${(meter / 1000).toFixed(2)} km` : `${Math.round(meter)} m`;
}
