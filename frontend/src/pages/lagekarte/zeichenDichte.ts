import { addSymbolImage, type MapLike, type SymbolImageOptions } from '@einsatzzeichen/maplibre';
import type { Drawing } from '@einsatzzeichen/schema';
import { ZEICHEN_KARTEN_PX, type ZeichenQuelle } from './markerIcons';

/**
 * Die Fachobjekt-Zeichen folgen der Pixeldichte des Bildschirms (LFH-842). Der Resolver in
 * `Kartenflaeche.tsx` rastert ein `ez|`-Bild beim ersten Bedarf in `kartenPixelRatio(dpr)`; wandert
 * das Fenster auf einen Monitor anderer Dichte oder ändert sich der Browser-Zoom, blieben die schon
 * registrierten Bilder sonst bis zum nächsten Stilwechsel in der alten Dichte (unscharf).
 */

/** Der Ausschnitt des Fensters, den der Beobachter braucht; `window` erfüllt ihn. */
export interface DichteFenster {
  readonly devicePixelRatio: number;
  readonly matchMedia?: (media: string) => {
    addEventListener(typ: 'change', hoerer: () => void): void;
    removeEventListener(typ: 'change', hoerer: () => void): void;
  };
}

/**
 * Meldet jeden Wechsel der Pixeldichte mit der neuen Dichte. Eine `resolution`-Abfrage kippt nur
 * einmal (wenn die Dichte ihren Wert verlässt), deshalb hängt jeder Wechsel eine neue Abfrage auf
 * die dann herrschende Dichte an. Gibt die Abmeldung zurück.
 */
export function beobachtePixeldichte(
  fenster: DichteFenster,
  onWechsel: (dichte: number) => void,
): () => void {
  if (typeof fenster.matchMedia !== 'function') return () => {};
  let abmelden = () => {};
  const anmelden = () => {
    const abfrage = fenster.matchMedia!(`(resolution: ${fenster.devicePixelRatio}dppx)`);
    const hoerer = () => {
      abmelden();
      anmelden();
      onWechsel(fenster.devicePixelRatio);
    };
    abfrage.addEventListener('change', hoerer);
    abmelden = () => abfrage.removeEventListener('change', hoerer);
  };
  anmelden();
  return () => abmelden();
}

/** Der Ausschnitt der MapLibre-Karte, den das Neu-Rastern braucht. */
export interface ZeichenKarte extends MapLike {
  listImages(): string[];
  removeImage(id: string): void;
}

type Zeichne = (
  karte: ZeichenKarte,
  id: string,
  drawing: Drawing,
  optionen: SymbolImageOptions,
) => unknown;

/**
 * Ersetzt jedes registrierte `ez|`-Bild durch eine Rasterung in `pixelRatio`. Entfernen und neu
 * anlegen, nicht `updateImage`: das verlangt gleiche Maße. MapLibre markiert beide Schritte als
 * Bildänderung und lädt die Kacheln, die das Bild nutzen, beim nächsten Update neu — das ist das
 * Neu-Layout. Während eines Stilwechsels (`listImages` wirft) bleibt alles stehen: der neue Stil
 * hat keine Bilder, und der Resolver rastert sie in der dann aktuellen Dichte.
 */
export function rastereZeichenNeu(
  karte: ZeichenKarte,
  registry: ReadonlyMap<string, ZeichenQuelle>,
  pixelRatio: number,
  zeichne: Zeichne = addSymbolImage,
): void {
  let ids: string[];
  try {
    ids = karte.listImages();
  } catch {
    return;
  }
  for (const id of ids) {
    if (!id.startsWith('ez|')) continue;
    const quelle = registry.get(id);
    if (quelle?.art !== 'ez') continue;
    karte.removeImage(id);
    try {
      zeichne(karte, id, quelle.drawing, { size: ZEICHEN_KARTEN_PX, pixelRatio });
    } catch {
      // Wie im Resolver: kein Bild ist besser als ein Fehler; beim nächsten Layout fragt MapLibre
      // das fehlende Bild erneut beim Resolver an.
    }
  }
}
