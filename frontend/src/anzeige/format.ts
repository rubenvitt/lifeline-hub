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

/** Zeitformat-Maske für Uhrzeit-Teil (12h → `hh:mm A`, sonst `HH:mm`). */
function uhrzeitMaske(konv: AnzeigeKonventionen): string {
  return konv.zeitformat === '12h' ? 'hh:mm A' : 'HH:mm';
}

/** UTC-Wirestring → `DD.MM.YYYY HH:mm` (bzw. 12h/Zeitzone); leer → ''. */
export function formatZeit(
  utcStr?: string | null,
  konv: AnzeigeKonventionen = DEFAULT_KONVENTIONEN,
): string {
  if (!utcStr) return '';
  return inZone(utcStr, konv).format(`DD.MM.YYYY ${uhrzeitMaske(konv)}`);
}

/** UTC-Wirestring → `HH:mm` wenn heute (in der Konvention-Zeitzone), sonst `DD.MM. HH:mm`. */
export function formatZeitKurz(
  utcStr?: string | null,
  konv: AnzeigeKonventionen = DEFAULT_KONVENTIONEN,
): string {
  if (!utcStr) return '';
  const d = inZone(utcStr, konv);
  // „Heute" muss in derselben Zeitzone bestimmt werden, sonst kippt die Tagesgrenze.
  const jetzt = konv.zeitzone ? dayjs().tz(konv.zeitzone) : dayjs();
  const maske = uhrzeitMaske(konv);
  return d.isSame(jetzt, 'day') ? d.format(maske) : d.format(`DD.MM. ${maske}`);
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
