import type { TzProps } from './taktischesZeichen';

/**
 * Deterministischer, eindeutiger MapLibre-Image-Key für ein taktisches Zeichen.
 * Gleicher TZ → gleicher Key (Icon wird genau einmal registriert und mehrfach genutzt).
 * Das `tz|`-Präfix erlaubt dem `styleimagemissing`-Handler, fremde Image-IDs zu ignorieren.
 */
export function tzIconKey(tz: TzProps): string {
  return [
    'tz',
    tz.grundzeichen ?? '',
    tz.organisation ?? '',
    tz.fachaufgabe ?? '',
    tz.einheit ?? '',
    tz.symbol ?? '',
    tz.farbe ?? '',
    tz.funktion ?? '',
  ].join('|');
}
