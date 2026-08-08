/**
 * Reine, framework-freie Formatlogik für Anzeige-Konventionen (LFH-136):
 * Zeit (Zeitzone + 24h/12h), Koordinaten (WGS84/MGRS/UTM) und Einheiten
 * (metrisch/imperial). Provider/Hook (AnzeigeKonventionenContext) und die
 * zentrale `kommunikation/zeit.ts` delegieren hierher.
 *
 * `DEFAULT_KONVENTIONEN` reproduziert byte-genau das bisherige Verhalten
 * (lokal `DD.MM.YYYY HH:mm`, Koordinate dezimal `lat.toFixed(5), lon.toFixed(5)`),
 * damit Bestandskonsumenten unverändert grün bleiben.
 */
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import type { Zeitformat, EinheitenSystem, Koordinatenformat } from '../api/types';
import { formatiere } from './koordinaten';

// Idempotent (mehrfaches extend ist unschädlich) — robust bei isoliertem Import.
dayjs.extend(utc);
dayjs.extend(timezone);

export interface AnzeigeKonventionen {
  zeitzone?: string | null;
  zeitformat?: Zeitformat | null;
  einheiten?: EinheitenSystem | null;
  koordinatenformat?: Koordinatenformat | null;
}

/** Default = heutiges Verhalten (alles null → lokal, 24h, dezimal, metrisch). */
export const DEFAULT_KONVENTIONEN: AnzeigeKonventionen = {
  zeitzone: null,
  zeitformat: null,
  einheiten: null,
  koordinatenformat: null,
};

/**
 * UTC-Wirestring → dayjs in der gewünschten Zeitzone (sonst lokal).
 *
 * `d.tz(zone)` wirft bei ungültiger IANA-Zone einen `RangeError` (intern
 * `Intl.DateTimeFormat`). Da das Zeitzonen-Feld Freitext ist und das Backend nur
 * „nicht-leer" prüft, könnte ein Tippfehler (z. B. `Europe/Brelin`) sonst bei
 * JEDEM Zeit-Rendering den ganzen Einsatz-Subtree crashen. Defensiver Fallback
 * auf lokale Zeit (Review LFH-136).
 */
function inZone(utcStr: string, konv: AnzeigeKonventionen) {
  const d = dayjs.utc(utcStr);
  if (!konv.zeitzone) return d.local();
  try {
    return d.tz(konv.zeitzone);
  } catch {
    return d.local();
  }
}

/**
 * Deutsche Monats-Großkürzel für die taktische Datum-Zeit-Gruppe (LFH-141).
 * dayjs' `MMM`-Token liefert das nicht (de-Locale → "Jan."/"Juli", en → gemischt,
 * nie großgeschrieben-punktlos), daher ein eigenes Array, indexiert über `.month()` (0–11).
 */
const MONATE_DE = ['JAN', 'FEB', 'MÄR', 'APR', 'MAI', 'JUN', 'JUL', 'AUG', 'SEP', 'OKT', 'NOV', 'DEZ'];

/**
 * Taktische Uhrzeit als vierstellige Gruppe „1430" (LFH-141). BOS-Konvention ist inhärent
 * 24h; das 12h/24h-Setting (LFH-136) wird für die taktische Anzeige bewusst ignoriert.
 */
export function taktischeUhrzeit(
  utcStr?: string | null,
  konv: AnzeigeKonventionen = DEFAULT_KONVENTIONEN,
): string {
  if (!utcStr) return '';
  return inZone(utcStr, konv).format('HHmm');
}

/** Taktische Datum-Zeit-Gruppe kurz „161430" (Tag + Uhrzeit, ohne Monat/Jahr). */
export function taktischeDtg(
  utcStr?: string | null,
  konv: AnzeigeKonventionen = DEFAULT_KONVENTIONEN,
): string {
  if (!utcStr) return '';
  return inZone(utcStr, konv).format('DDHHmm');
}

/** Volle taktische DTG „161430JUL2026" (Tag + Uhrzeit + dt. Monatskürzel + Jahr). */
export function taktischeDtgVoll(
  utcStr?: string | null,
  konv: AnzeigeKonventionen = DEFAULT_KONVENTIONEN,
): string {
  if (!utcStr) return '';
  const d = inZone(utcStr, konv);
  return `${d.format('DDHHmm')}${MONATE_DE[d.month()]}${d.format('YYYY')}`;
}

/** Volle Zeitangabe → taktische DTG „161430JUL2026" (ersetzt das frühere `DD.MM.YYYY HH:mm`). */
export function formatZeit(
  utcStr?: string | null,
  konv: AnzeigeKonventionen = DEFAULT_KONVENTIONEN,
): string {
  return taktischeDtgVoll(utcStr, konv);
}

/** Kurze Zeitangabe → taktische Uhrzeit „1430" wenn heute, sonst kurze DTG „161430". */
export function formatZeitKurz(
  utcStr?: string | null,
  konv: AnzeigeKonventionen = DEFAULT_KONVENTIONEN,
): string {
  if (!utcStr) return '';
  const d = inZone(utcStr, konv);
  // „Heute" muss in derselben Zeitzone bestimmt werden, sonst kippt die Tagesgrenze.
  const jetzt = konv.zeitzone ? dayjs().tz(konv.zeitzone) : dayjs();
  return d.isSame(jetzt, 'day') ? d.format('HHmm') : d.format('DDHHmm');
}

/**
 * Reine Uhrzeit `HH:mm` in der Anzeigezone — für Instrumente, die den Tag schon
 * aus dem Zusammenhang kennen (Lage-Dashboard: alles vom laufenden Einsatz).
 *
 * Der Leerwert ist ein Leerstrich in Ziffernbreite (`——:——`) und nicht der leere
 * String wie bei den DTG-Formatierern: er steht in einer Instrumentenspalte, und
 * eine Lücke, die zusammenfällt, verschiebt die Zeilen daneben.
 */
export function formatUhrzeit(
  utcStr?: string | null,
  konv: AnzeigeKonventionen = DEFAULT_KONVENTIONEN,
): string {
  if (!utcStr) return '——:——';
  return inZone(utcStr, konv).format('HH:mm');
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
