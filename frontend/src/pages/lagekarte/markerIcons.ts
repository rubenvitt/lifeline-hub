import type { Drawing } from '@einsatzzeichen/schema';
import { fachobjektZeichen } from '../../zeichen/fachobjektZeichen';
import { freiesZeichen } from '../../zeichen/freiesZeichen';
import type { KarteMarker } from './marker';

type MitZeichen = Pick<KarteMarker, 'typ' | 'tz' | 'freiesZeichen'>;

/** Das Zeichen eines Markers aus seiner einen Quelle: Leseadapter oder Fachobjekt-Übersetzung. */
function zeichenVon(mk: MitZeichen): { schluessel: string; drawing: Drawing } | null {
  if (mk.typ === 'freies_zeichen') return mk.freiesZeichen ? freiesZeichen(mk.freiesZeichen) : null;
  return mk.tz ? fachobjektZeichen(mk.tz) : null;
}

/**
 * Der Bildschlüssel eines Markers — die eine Quelle für die Feature-Property `icon` und die Registry
 * des Bild-Resolvers (`kartenbildResolver.ts`; LFH-835 design.md D5, LFH-836 design.md D8). Alle
 * Zeichen zeichnet @einsatzzeichen: `ez|` + wirksame Spec, freie Zeichen über den Leseadapter
 * (`zeichen/freiesZeichen.ts`), Fachobjekte über `fachobjektZeichen`. Gleiche Spec heißt gleicher
 * Schlüssel, auch über Fachobjekte und freie Zeichen hinweg. Ohne Zeichen oder ohne darstellbaren
 * Körper eines Fachobjekts kein Schlüssel: der Marker bleibt ein Kreis. Ein freies Zeichen hat
 * immer einen (zur Not den Platzhalter).
 */
export function markerIconKey(mk: MitZeichen): string | undefined {
  return zeichenVon(mk)?.schluessel;
}

/** Bildschlüssel → Zeichnung, für alle Marker mit Zeichen; gleiche Zeichen einmal. */
export function baueZeichenRegistry(markers: ReadonlyArray<MitZeichen>): Map<string, Drawing> {
  const registry = new Map<string, Drawing>();
  for (const mk of markers) {
    const zeichen = zeichenVon(mk);
    if (zeichen && !registry.has(zeichen.schluessel)) {
      registry.set(zeichen.schluessel, zeichen.drawing);
    }
  }
  return registry;
}

/** Kantenlänge eines Zeichens auf der Karte in CSS-px; der Statusring ist darauf abgestimmt. */
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
