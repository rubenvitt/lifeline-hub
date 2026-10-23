/**
 * Reine Formatlogik für Anzeige-Konventionen: Zeit (Zeitzone + Zeitdarstellung), Koordinaten
 * (WGS84/MGRS/UTM/GK) und Einheiten (metrisch/imperial). Provider/Hook delegieren hierher.
 */
import type { Dayjs } from 'dayjs';
import type { EinheitenSystem, Koordinatenformat, Zeitdarstellung } from '../api/types';
import { formatiere } from './koordinaten';
import { zahlText } from './zahl';
import { zeitpunkt } from './zeitDarstellung';

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

// Zeit: der Kern steht in `zeitDarstellung.ts` (LLH-1053); seine drei Rollen nimmt man von dort.
// Die alten Namen (`formatZeit`, `formatUhrzeit`, `taktischeDtg` …) sind mit LLH-1061 entfallen.
export { inZone, MONATE_DTG } from './zeitDarstellung';

/**
 * Volle DTG „161430okt26“ eines Zeitpunkts in der Anzeigezone, immer taktisch: das Zeitfeld zeigt
 * seinen Wert so, unabhängig von der Darstellung (Spec `zeiteingabe`, „Anzeige im Feld als
 * Datum-Zeit-Gruppe“). Ohne gültige Zone in der Browserzone.
 */
export function formatDtg(zeitpunktWert: Dayjs, zone: string | null | undefined): string {
  return zeitpunkt(zeitpunktWert, { zeitzone: zone, zeitdarstellung: 'taktisch' });
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
