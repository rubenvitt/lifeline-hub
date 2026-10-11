import type { Drawing } from '@einsatzzeichen/schema';
import { PLAKETTE_PRAEFIX, plakettenBild } from './plakette';

/** Der Ausschnitt der Karte, den der Resolver braucht (jsdom hat keine echte). */
export interface KartenbildZiel {
  hasImage(id: string): boolean;
  addImage(
    id: string,
    bild: HTMLImageElement | { width: number; height: number; data: Uint8Array },
    optionen?: Record<string, unknown>,
  ): unknown;
}

export interface KartenbildQuellen {
  /** Bildschlüssel → Zeichnung der aktuellen Marker (`baueZeichenRegistry`). */
  zeichen: () => ReadonlyMap<string, Drawing>;
  /** Zeichen synchron anlegen (`addSymbolImage`). */
  zeichneEz: (id: string, drawing: Drawing) => void;
}

/**
 * Der eine Weg, auf dem die Lagekarte ihre Bilder anlegt: für `map.setMissingStyleImageResolver`,
 * nicht für `styleimagemissing` (LFH-841, LFH-835 design.md D5). MapLibre 6 baut die Bildantwort
 * einer Kachel, BEVOR es das Event feuert — ein dort angelegtes Bild fehlte im laufenden Layout und
 * erschiene erst beim nächsten Neu-Layout, nach einem Stilwechsel ohne neue Daten nie. Den Resolver
 * (samt Promise) wartet MapLibre ab, und er überlebt `setStyle`.
 *
 * - `plakette|` (Beschriftung, 9-Slice) und `ez|` (Fachobjekte und freie Zeichen, seit LFH-836
 *   design.md D8 ein Weg) synchron. Den asynchronen `tz|`-Weg des Altpakets gibt es nicht mehr.
 *
 * Nichts wirft: ein fehlendes Bild ist besser als ein Fehler im MapLibre-Callback (der Marker
 * bleibt klickbar, die Beschriftung steht ohne Plakette).
 */
export function kartenbildResolver(
  karte: KartenbildZiel,
  quellen: KartenbildQuellen,
): (id: string) => void {
  return (id) => {
    if (karte.hasImage(id)) return;

    if (id.startsWith(PLAKETTE_PRAEFIX)) {
      const bild = plakettenBild(id);
      if (!bild) return;
      const { width, height, data, ...dehnung } = bild;
      karte.addImage(id, { width, height, data }, dehnung);
      return;
    }

    if (id.startsWith('ez|')) {
      const drawing = quellen.zeichen().get(id);
      if (!drawing) return;
      try {
        quellen.zeichneEz(id, drawing);
      } catch {
        // Kein Bild; der Marker bleibt klickbar.
      }
      return;
    }
  };
}
