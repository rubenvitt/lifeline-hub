import type { Drawing } from '@einsatzzeichen/schema';
import {
  bereitstellungsraumZeichen,
  fachobjektZeichen,
  tierZeichen,
} from '../../zeichen/fachobjektZeichen';
import { freiesZeichen } from '../../zeichen/freiesZeichen';
import type { KartenTheme } from './basemapStil';
import type { KarteMarker } from './marker';

type MitZeichen = Pick<KarteMarker, 'typ' | 'tz' | 'freiesZeichen'>;

/**
 * Das Zeichen eines Markers aus seiner einen Quelle: Leseadapter oder Fachobjekt-Übersetzung. Karte
 * (`markerIconKey`, `baueZeichenRegistry`) und Inspector-Kachel lesen es nur hier.
 */
export function markerZeichen(mk: MitZeichen): { schluessel: string; drawing: Drawing } | null {
  if (mk.typ === 'freies_zeichen') return mk.freiesZeichen ? freiesZeichen(mk.freiesZeichen) : null;
  // Das Raumzeichen ist ein freistehendes Führungszeichen, kein Grundzeichen mit Merkmalen: es
  // hängt am Typ (LLH-1107).
  if (mk.typ === 'bereitstellungsraum') return bereitstellungsraumZeichen();
  // Das Tier ohne Zustand (LLH-1343) hängt ebenso am Typ.
  if (mk.typ === 'tier') return tierZeichen();
  return mk.tz ? fachobjektZeichen(mk.tz) : null;
}

/**
 * Präfix der Bilder für die dunkle Kartengrundlage (LLH-1141). Es beginnt mit `ez|`, damit Resolver
 * und Neu-Rastern bei Dichtewechsel (`zeichenDichte.ts`) diese Bilder wie jedes andere Zeichen führen.
 */
const DUNKEL_PRAEFIX = 'ez|dark|';

/**
 * Für welches Kartenthema ist ein Kartenbild gerastert? Allein der Schlüssel sagt es; gezeichnet
 * wird über `zeichneKartenZeichen` (`zeichenDichte.ts`), nachts mit dem Render-Theme `dark`.
 */
export function bildKartenTheme(id: string): KartenTheme {
  return id.startsWith(DUNKEL_PRAEFIX) ? 'dark' : 'light';
}

/**
 * Der Bildschlüssel eines Zeichens unter dem Kartenthema (LLH-1141): auf dunkler Kartengrundlage
 * rastert das Zeichen mit dem Render-Theme `dark` der Bibliothek (`zeichen/zeichenTheme.ts`), denn
 * Zeichen ohne Organisation zeichnet sie sonst mit schwarzem Umriss ohne Fläche, nachts schwarz auf
 * schwarz. Am Tag bleibt der Schlüssel, wie er war. Weil das Thema im Schlüssel steht, bekommt
 * jeder Marker beim Wechsel ein anderes Bild, das der Resolver neu rastert, ohne Neuladen.
 */
function bildSchluessel(schluessel: string, kartenTheme: KartenTheme): string {
  return kartenTheme === 'dark' ? `${DUNKEL_PRAEFIX}${schluessel.slice('ez|'.length)}` : schluessel;
}

/**
 * Der Bildschlüssel eines Markers — die eine Quelle für die Feature-Property `icon` und die Registry
 * des Bild-Resolvers (`kartenbildResolver.ts`; LFH-835 design.md D5, LFH-836 design.md D8). Alle
 * Zeichen zeichnet @einsatzzeichen: `ez|` + wirksame Spec, freie Zeichen über den Leseadapter
 * (`zeichen/freiesZeichen.ts`), Fachobjekte über `fachobjektZeichen`. Gleiche Spec heißt gleicher
 * Schlüssel, auch über Fachobjekte und freie Zeichen hinweg. Ohne Zeichen oder ohne darstellbaren
 * Körper eines Fachobjekts kein Schlüssel: der Marker bleibt ein Kreis. Ein freies Zeichen hat
 * immer einen (zur Not den Platzhalter). Nachts mit eigenem Präfix ({@link bildKartenTheme}).
 */
export function markerIconKey(
  mk: MitZeichen,
  kartenTheme: KartenTheme = 'light',
): string | undefined {
  const zeichen = markerZeichen(mk);
  return zeichen ? bildSchluessel(zeichen.schluessel, kartenTheme) : undefined;
}

/** Bildschlüssel → Zeichnung, für alle Marker mit Zeichen; gleiche Zeichen einmal. */
export function baueZeichenRegistry(
  markers: ReadonlyArray<MitZeichen>,
  kartenTheme: KartenTheme = 'light',
): Map<string, Drawing> {
  const registry = new Map<string, Drawing>();
  for (const mk of markers) {
    const zeichen = markerZeichen(mk);
    if (!zeichen) continue;
    const schluessel = bildSchluessel(zeichen.schluessel, kartenTheme);
    if (!registry.has(schluessel)) registry.set(schluessel, zeichen.drawing);
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
