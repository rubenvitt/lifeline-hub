/**
 * Reine Formatlogik für Anzeige-Konventionen: Zeit (Zeitzone + Zeitdarstellung), Koordinaten
 * (WGS84/MGRS/UTM/GK) und Einheiten (metrisch/imperial). Provider/Hook delegieren hierher.
 */
import type { Dayjs } from 'dayjs';
import type { EinheitenSystem, Koordinatenformat, Zeitdarstellung } from '../api/types';
import { formatiere } from './koordinaten';
import { zahlText } from './zahl';
import { inZone, leereUhrzeit, uhrzeit, zeitKurz, zeitMitTag, zeitpunkt } from './zeitDarstellung';

export interface AnzeigeKonventionen {
  zeitzone?: string | null;
  zeitdarstellung?: Zeitdarstellung | null;
  einheiten?: EinheitenSystem | null;
  koordinatenformat?: Koordinatenformat | null;
}

/**
 * Default: alles null → lokal, taktisch, dezimal, metrisch.
 *
 * Die Zeitformatierer unten nehmen ihn NICHT als Vorgabe, die Konventionen sind dort Pflicht
 * (LFH-913): ein Aufruf ohne Konventionen formatierte still in der Browserzone, auch unter dem
 * `EinsatzAnzeigeProvider`. Der Typprüfer findet so jede vergessene Stelle; in Komponenten die
 * gebundenen Formatierer aus `useAnzeigeKonventionen()` oder `ZeitAnzeige`. Wer bewusst die
 * Browserzone will, übergibt `DEFAULT_KONVENTIONEN` ausdrücklich.
 */
export const DEFAULT_KONVENTIONEN: AnzeigeKonventionen = {
  zeitzone: null,
  zeitdarstellung: null,
  einheiten: null,
  koordinatenformat: null,
};

// Zeit: der Kern steht in `zeitDarstellung.ts` (LLH-1053). Die Namen hier sind dünne
// Weiterleitungen auf seine drei Rollen, bis LLH-1061 die Aufrufer umstellt; sie folgen damit der
// wirksamen Darstellung in den Konventionen, auch wenn der Name „taktisch“ sagt.
export { inZone, MONATE_DTG } from './zeitDarstellung';

/** @deprecated `uhrzeit` aus `zeitDarstellung.ts`. */
export function taktischeUhrzeit(
  utcStr: string | null | undefined,
  konv: AnzeigeKonventionen,
): string {
  return uhrzeit(utcStr, konv);
}

/**
 * @deprecated Tag und Uhrzeit ohne Heute-Prüfung (`161430` bzw. `16.10. 14:30`), die Form von
 * `zeitKurz` an einem anderen Tag. Bleibt rein (liest keine Uhr), deshalb kein `zeitKurz`.
 */
export function taktischeDtg(utcStr: string | null | undefined, konv: AnzeigeKonventionen): string {
  if (!utcStr) return '';
  return zeitMitTag(inZone(utcStr, konv), konv.zeitdarstellung ?? 'taktisch');
}

/** @deprecated `zeitpunkt` aus `zeitDarstellung.ts`. */
export function taktischeDtgVoll(
  utcStr: string | null | undefined,
  konv: AnzeigeKonventionen,
): string {
  return zeitpunkt(utcStr, konv);
}

/**
 * Volle DTG „161430okt26“ eines Zeitpunkts in der Anzeigezone, immer taktisch: das Zeitfeld zeigt
 * seinen Wert so, unabhängig von der Darstellung (Spec `zeiteingabe`, „Anzeige im Feld als
 * Datum-Zeit-Gruppe“). Ohne gültige Zone in der Browserzone.
 */
export function formatDtg(zeitpunktWert: Dayjs, zone: string | null | undefined): string {
  return zeitpunkt(zeitpunktWert, { zeitzone: zone, zeitdarstellung: 'taktisch' });
}

/** @deprecated `zeitpunkt` aus `zeitDarstellung.ts`. */
export function formatZeit(utcStr: string | null | undefined, konv: AnzeigeKonventionen): string {
  return zeitpunkt(utcStr, konv);
}

/** @deprecated `zeitKurz` aus `zeitDarstellung.ts`. */
export function formatZeitKurz(
  utcStr: string | null | undefined,
  konv: AnzeigeKonventionen,
): string {
  return zeitKurz(utcStr, konv);
}

/**
 * @deprecated `uhrzeit` aus `zeitDarstellung.ts`; der Leerwert hat Ziffernbreite
 * (`leereUhrzeit`), damit eine Lücke in einer Instrumentenspalte die Nachbarzeilen nicht
 * verschiebt.
 */
export function formatUhrzeit(
  utcStr: string | null | undefined,
  konv: AnzeigeKonventionen,
): string {
  if (!utcStr) return leereUhrzeit(konv);
  return uhrzeit(utcStr, konv);
}

/**
 * @deprecated `zeitKurz` aus `zeitDarstellung.ts` — für Fristen, bei denen „in 20 Minuten“ sonst
 * nicht von „morgen früh“ zu unterscheiden wäre; Leerwert wie {@link formatUhrzeit}.
 */
export function formatUhrzeitMitTag(
  utcStr: string | null | undefined,
  konv: AnzeigeKonventionen,
): string {
  if (!utcStr) return leereUhrzeit(konv);
  return zeitKurz(utcStr, konv);
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

/** Distanz in Metern → Anzeige-String je Einheiten-System (Default: metrisch), mit Dezimalkomma. */
export function formatDistanz(
  meter: number,
  konv: AnzeigeKonventionen = DEFAULT_KONVENTIONEN,
): string {
  if (konv.einheiten === 'imperial') {
    const feet = meter * 3.28084;
    return feet >= 5280 ? `${zahlText(feet / 5280, { stellen: 2 })} mi` : `${zahlText(feet)} ft`;
  }
  return meter >= 1000 ? `${zahlText(meter / 1000, { stellen: 2 })} km` : `${zahlText(meter)} m`;
}
