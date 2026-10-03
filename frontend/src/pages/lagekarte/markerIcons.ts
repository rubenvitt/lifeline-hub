import type { Drawing } from '@einsatzzeichen/schema';
import { fachobjektZeichen } from '../../zeichen/fachobjektZeichen';
import type { KarteMarker } from './marker';
import type { TzProps } from './taktischesZeichen';

/**
 * Deterministischer, eindeutiger MapLibre-Image-Key für ein taktisches Zeichen.
 * Gleicher TZ → gleicher Key (Icon wird genau einmal registriert und mehrfach genutzt).
 * Am `tz|`-Präfix erkennt der Bild-Resolver (`kartenbildResolver.ts`) den Weg über das Altpaket.
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

/**
 * Der Bildschlüssel eines Markers — die eine Quelle für die Feature-Property `icon` und die Registry
 * des Bild-Resolvers (`kartenbildResolver.ts`; LFH-835, design.md D5). Freie Zeichen zeichnet bis LFH-836 das
 * Altpaket (`tz|`), alle übrigen Marker @einsatzzeichen (`ez|` + wirksame Spec). Ohne `tz` oder
 * ohne darstellbaren Körper kein Schlüssel: der Marker bleibt ein Kreis.
 */
export function markerIconKey(mk: Pick<KarteMarker, 'typ' | 'tz'>): string | undefined {
  if (!mk.tz) return undefined;
  if (mk.typ === 'freies_zeichen') return tzIconKey(mk.tz);
  return fachobjektZeichen(mk.tz)?.schluessel;
}

/** Woraus der Bild-Resolver (`kartenbildResolver.ts`) ein Kartenbild erzeugt. */
export type ZeichenQuelle = { art: 'ez'; drawing: Drawing } | { art: 'tz'; tz: TzProps };

/** Bildschlüssel → Quelle, für alle Marker mit Zeichen; gleiche Zeichen einmal. */
export function baueZeichenRegistry(
  markers: ReadonlyArray<Pick<KarteMarker, 'typ' | 'tz'>>,
): Map<string, ZeichenQuelle> {
  const registry = new Map<string, ZeichenQuelle>();
  for (const mk of markers) {
    const key = markerIconKey(mk);
    if (!key || !mk.tz || registry.has(key)) continue;
    if (mk.typ === 'freies_zeichen') {
      registry.set(key, { art: 'tz', tz: mk.tz });
    } else {
      const zeichen = fachobjektZeichen(mk.tz);
      if (zeichen) registry.set(key, { art: 'ez', drawing: zeichen.drawing });
    }
  }
  return registry;
}

/** Kantenlänge eines Fachobjekt-Zeichens auf der Karte in CSS-px; der Statusring ist darauf abgestimmt. */
export const ZEICHEN_KARTEN_PX = 34;

/**
 * Rasterdichte der Kartenbilder: die Pixeldichte des Bildschirms, aufgerundet — `size × pixelRatio`
 * muss für @einsatzzeichen/maplibre ganzzahlig sein (Fükw-Laptops laufen oft mit 1,25 oder 1,5).
 */
export function kartenPixelRatio(devicePixelRatio: number): number {
  return Number.isFinite(devicePixelRatio) ? Math.max(1, Math.ceil(devicePixelRatio)) : 1;
}

/** SVG-Fassung der Inspector-Kachel; eigener `idPrefix`, damit keine `id` mit Listen-Zeichen kollidiert. */
export const KACHEL_SVG_OPTIONEN = { size: 64, idPrefix: 'inspector-kachel' } as const;
