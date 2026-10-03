import type { Drawing } from '@einsatzzeichen/schema';
import type { ZeichenQuelle } from './markerIcons';
import { PLAKETTE_PRAEFIX, plakettenBild } from './plakette';
import type { TzProps } from './taktischesZeichen';

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
  /** Bildschlüssel → Zeichenquelle der aktuellen Marker (`baueZeichenRegistry`). */
  zeichen: () => ReadonlyMap<string, ZeichenQuelle>;
  /** Fachobjekt-Zeichen synchron anlegen (`addSymbolImage`). */
  zeichneEz: (id: string, drawing: Drawing) => void;
  /** Freies Zeichen über das Altpaket laden; darf synchron werfen. */
  ladeTz: (tz: TzProps) => Promise<{ bild: HTMLImageElement; pixelRatio: number }>;
}

/**
 * Der eine Weg, auf dem die Lagekarte ihre Bilder anlegt: für `map.setMissingStyleImageResolver`,
 * nicht für `styleimagemissing` (LFH-841, LFH-835 design.md D5). MapLibre 6 baut die Bildantwort
 * einer Kachel, BEVOR es das Event feuert — ein dort angelegtes Bild fehlte im laufenden Layout und
 * erschiene erst beim nächsten Neu-Layout, nach einem Stilwechsel ohne neue Daten nie. Den Resolver
 * (samt Promise) wartet MapLibre ab, und er überlebt `setStyle`.
 *
 * - `plakette|` (Beschriftung, 9-Slice) und `ez|` (Fachobjekt) synchron.
 * - `tz|` (freie Zeichen, Altpaket) asynchron über ein Promise, bis LFH-836 sie auf `ez|` umstellt;
 *   fragen zwei Kacheln gleichzeitig, teilen sie sich das Laden.
 *
 * Nichts wirft: ein fehlendes Bild ist besser als ein Fehler im MapLibre-Callback (der Marker
 * bleibt klickbar, die Beschriftung steht ohne Plakette).
 */
export function kartenbildResolver(
  karte: KartenbildZiel,
  quellen: KartenbildQuellen,
): (id: string) => void | Promise<void> {
  const ladend = new Map<string, Promise<void>>();

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
      const quelle = quellen.zeichen().get(id);
      if (quelle?.art !== 'ez') return;
      try {
        quellen.zeichneEz(id, quelle.drawing);
      } catch {
        // Kein Bild; der Marker bleibt klickbar.
      }
      return;
    }

    if (id.startsWith('tz|')) {
      const laufend = ladend.get(id);
      if (laufend) return laufend;
      const quelle = quellen.zeichen().get(id);
      if (quelle?.art !== 'tz') return;
      let laden: ReturnType<KartenbildQuellen['ladeTz']>;
      try {
        // `erzeugeTaktischesZeichen` wirft bei nicht DV-102-konformen Werten synchron.
        laden = quellen.ladeTz(quelle.tz);
      } catch {
        return;
      }
      const fertig = laden
        .then(({ bild, pixelRatio }) => {
          if (!karte.hasImage(id)) karte.addImage(id, bild, { pixelRatio });
        })
        // Ladefehler oder schon abgebaute Karte: ohne Bild weiter, das nächste Layout fragt neu.
        .catch(() => {})
        .finally(() => ladend.delete(id));
      ladend.set(id, fertig);
      return fertig;
    }
  };
}
