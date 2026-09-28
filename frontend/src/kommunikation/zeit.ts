/**
 * Zeitformatierung der Kommunikations-Module. Backend-Zeiten sind UTC `YYYY-MM-DD HH:mm:ss`
 * ohne Zone; alles delegiert an `anzeige/format.ts`. Die parameterlosen Funktionen nutzen
 * `DEFAULT_KONVENTIONEN`, konventionsbewusst sind der Hook `useAnzeigeKonventionen()` und die
 * `*MitKonvention`-Varianten.
 */
import {
  DEFAULT_KONVENTIONEN,
  formatZeit as formatZeitKonv,
  formatZeitKurz as formatZeitKurzKonv,
  type AnzeigeKonventionen,
} from '../anzeige/format';

/** UTC-Wirestring → taktische DTG (Default-Konvention); leer → ''. */
export function formatZeit(utcStr?: string | null): string {
  return formatZeitKonv(utcStr, DEFAULT_KONVENTIONEN);
}

/** UTC-Wirestring → taktische Uhrzeit wenn heute, sonst kurze DTG (Default); leer → ''. */
export function formatZeitKurz(utcStr?: string | null): string {
  return formatZeitKurzKonv(utcStr, DEFAULT_KONVENTIONEN);
}

/** Konvention-bewusste Variante (Zeitzone + 24h/12h) — für Hook-Konsumenten. */
export function formatZeitMitKonvention(
  utcStr: string | null | undefined,
  konventionen: AnzeigeKonventionen,
): string {
  return formatZeitKonv(utcStr, konventionen);
}

/** Konvention-bewusste Kurz-Variante. */
export function formatZeitKurzMitKonvention(
  utcStr: string | null | undefined,
  konventionen: AnzeigeKonventionen,
): string {
  return formatZeitKurzKonv(utcStr, konventionen);
}
