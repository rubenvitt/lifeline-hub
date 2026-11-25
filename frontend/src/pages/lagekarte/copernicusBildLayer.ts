import type { Map as MapLibreMap } from 'maplibre-gl';
import type { CopernicusBild } from './fachebenen';

/**
 * Copernicus-Satellitenbilder als Rasterlayer (LLH-2021). Je darstellbarem Bild eine Rasterquelle
 * auf die Kachelroute des Servers; der Browser spricht nie mit der Quelle selbst. Die Layer liegen
 * über der Grundkarte und unter allen Fachebenen, Kartenbildern und Abschnitten, das jüngste Bild
 * oben. Keine Klickebene: Herkunft und Alter stehen in der Ebenenzeile.
 * Entwurf: `docs/superpowers/specs/2026-11-24-h11vkn1p-copernicus-cog-rasterbilder-design.md`.
 */

const PRAEFIX = 'copernicus-bild-';
export const copernicusBildSourceId = (kennung: string) => `${PRAEFIX}${kennung}`;
export const copernicusBildLayerId = (kennung: string) => `${PRAEFIX}${kennung}-raster`;

const kachelUrl = (kennung: string) => `/api/map/overlays/copernicus/images/${kennung}/{z}/{x}/{y}`;

/**
 * Der Layer, unter dem die Bilder liegen: der unterste Kartenbild-, Abschnitts- oder
 * Fachebenen-Layer. Ohne einen davon kommen die Bilder ans Ende.
 */
export function copernicusBildAnker(map: MapLibreMap): string | undefined {
  const ids = map.getStyle()?.layers?.map((l) => l.id) ?? [];
  return ids.find(
    (id) =>
      !id.startsWith(PRAEFIX) &&
      (id.startsWith('bild-') || id.startsWith('fachebene-') || id === 'abschnitte-fill'),
  );
}

function verwalteteKennungen(map: MapLibreMap): string[] {
  return (map.getStyle()?.layers ?? [])
    .map((l) => l.id)
    .filter((id) => id.startsWith(PRAEFIX) && id.endsWith('-raster'))
    .map((id) => id.slice(PRAEFIX.length, -'-raster'.length));
}

const opazitaet = (deckkraft: number) => Math.min(100, Math.max(0, deckkraft)) / 100;

/**
 * Soll-Abgleich: legt fehlende Bilder an, setzt die Deckkraft, ordnet (jüngstes oben) und
 * entfernt, was nicht mehr in `bilder` steht oder nicht darstellbar ist. Die Reihenfolge folgt
 * der Aufnahmezeit, nicht der Liste.
 */
export function synchronisiereCopernicusBilder(
  map: MapLibreMap,
  bilder: CopernicusBild[],
  deckkraft: number,
): void {
  // Wire-Format `YYYY-MM-DD HH:MM:SS`: Textvergleich ist Zeitvergleich; ohne Aufnahme zuunterst.
  const soll = bilder
    .filter((b) => b.darstellbar)
    .sort((a, z) => (z.aufnahme ?? '').localeCompare(a.aufnahme ?? ''));
  const sollIds = new Set(soll.map((b) => b.bild));
  for (const k of verwalteteKennungen(map)) {
    if (sollIds.has(k)) continue;
    if (map.getLayer(copernicusBildLayerId(k))) map.removeLayer(copernicusBildLayerId(k));
    if (map.getSource(copernicusBildSourceId(k))) map.removeSource(copernicusBildSourceId(k));
  }
  const anker = copernicusBildAnker(map);
  const o = opazitaet(deckkraft);
  // Älteste zuerst unter den Anker: jedes weitere landet darüber, das jüngste zuoberst.
  for (const b of soll.reverse()) {
    const sid = copernicusBildSourceId(b.bild);
    const lid = copernicusBildLayerId(b.bild);
    if (!map.getSource(sid)) {
      map.addSource(sid, {
        type: 'raster',
        tiles: [kachelUrl(b.bild)],
        tileSize: 256,
        bounds: b.bounds,
        minzoom: b.minZoom,
        maxzoom: b.maxZoom,
      });
    }
    if (!map.getLayer(lid)) {
      map.addLayer(
        {
          id: lid,
          type: 'raster',
          source: sid,
          paint: { 'raster-opacity': o, 'raster-fade-duration': 0 },
        },
        anker,
      );
    } else {
      map.setPaintProperty(lid, 'raster-opacity', o);
      map.moveLayer(lid, anker);
    }
  }
}
