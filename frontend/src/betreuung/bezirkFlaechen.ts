import type { LageZone } from '../api/types';
import { parseGeometry } from '../pages/lagekarte/geo';
import { baueZonenFc, type ZonenFeatureCollection } from '../pages/lagekarte/kartenLayer';
import { PUNKT_ZOOM } from '../pages/lagekarte/startAnsicht';
import { zoneStil } from '../pages/lagekarte/zonenStil';

/** Ausschnitt eines Kartenbilds: ein Punkt mit Zoom oder ein Rahmen um alle Punkte. */
export type Ausschnitt =
  | { art: 'punkt'; lon: number; lat: number; zoom: number }
  | { art: 'rahmen'; west: number; sued: number; ost: number; nord: number };

export interface BezirkFlaechen {
  /** Die Flächen des Bezirks im Zonenstil der Lagekarte, ohne Beschriftung. */
  zonen: ZonenFeatureCollection;
  /** Zahl der lesbaren Flächen (eine unlesbare Geometrie fällt still weg, wie auf der Lagekarte). */
  anzahl: number;
  /** Ausschnitt um alle Stützpunkte; `null` ohne lesbare Fläche. */
  ausschnitt: Ausschnitt | null;
}

/**
 * Flächen eines Evakuierungsbezirks für den Kartenausschnitt der Detailseite (LLH-1076, design.md
 * D5): Zonen vom Typ `evakuierungsbezirk`, die diesem Bezirk zugeordnet sind (LFH-673). Rein.
 *
 * Gezeigt im Stil der Lagekarte (`zoneStil`), damit dieselbe Fläche auf beiden Karten gleich
 * aussieht. Der Ausschnitt rahmt jeden Stützpunkt.
 */
export function bezirkFlaechen(zonen: readonly LageZone[], bezirkId: number): BezirkFlaechen {
  const punkte: [number, number][] = [];
  const features = zonen.flatMap((z) => {
    if (z.typ !== 'evakuierungsbezirk' || z.evakuierungsbezirk_id !== bezirkId) return [];
    const geometrie = parseGeometry(z.geometrie);
    if (!geometrie) return [];
    const ring =
      geometrie.type === 'Polygon' ? (geometrie.coordinates[0] ?? []) : geometrie.coordinates;
    for (const [lon, lat] of ring) punkte.push([lon, lat]);
    return [{ id: z.id, geometrie, label: null, typ: z.typ, stil: zoneStil(z.typ, z.farbe) }];
  });
  return {
    zonen: baueZonenFc(features),
    anzahl: features.length,
    ausschnitt: rahmen(punkte),
  };
}

/**
 * Rahmen um alle Punkte, ein einzelner Punkt mit {@link PUNKT_ZOOM} — wie `monitorAusschnitt` der
 * Monitorkarte (`geraet/LagemonitorKarte.tsx`), hier ohne deren MapLibre-Import, damit der Kern rein
 * bleibt.
 */
function rahmen(punkte: readonly [number, number][]): Ausschnitt | null {
  if (punkte.length === 0) return null;
  const lons = punkte.map((p) => p[0]);
  const lats = punkte.map((p) => p[1]);
  const west = Math.min(...lons);
  const ost = Math.max(...lons);
  const sued = Math.min(...lats);
  const nord = Math.max(...lats);
  if (west === ost && sued === nord)
    return { art: 'punkt', lon: west, lat: sued, zoom: PUNKT_ZOOM };
  return { art: 'rahmen', west, sued, ost, nord };
}
