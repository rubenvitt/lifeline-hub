/**
 * Zeitformatierung der Kommunikations-Module (LFH-112).
 *
 * Backend liefert UTC-Strings im Format `YYYY-MM-DD HH:mm:ss` (ohne Zeitzone).
 * Seit LFH-136 delegiert dieses Modul an die zentrale Formatlogik in
 * `anzeige/format.ts`. Die parameterlosen Funktionen nutzen `DEFAULT_KONVENTIONEN`
 * und bleiben damit byte-identisch zum bisherigen Verhalten (rückwärtskompatibel
 * für die 7 Bestandskonsumenten). Konvention-bewusste Anzeige läuft über den Hook
 * `useAnzeigeKonventionen()` bzw. die `*MitKonvention`-Varianten.
 */
import {
  DEFAULT_KONVENTIONEN,
  formatZeit as formatZeitKonv,
  formatZeitKurz as formatZeitKurzKonv,
  type AnzeigeKonventionen,
} from '../anzeige/format';

/** UTC-Wirestring → lokal `DD.MM.YYYY HH:mm` (Default-Konvention); leer → ''. */
export function formatZeit(utcStr?: string | null): string {
  return formatZeitKonv(utcStr, DEFAULT_KONVENTIONEN);
}

/** UTC-Wirestring → `HH:mm` wenn heute, sonst `DD.MM. HH:mm` (Default); leer → ''. */
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
