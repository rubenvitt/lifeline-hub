import type { LagemonitorAbschnitt, LagemonitorZone } from '../api/types';
import {
  parseGeometry,
  parsePolygon,
  polygonZentroid,
  type GeoJsonPolygon,
} from '../pages/lagekarte/geo';
import {
  baueFlaechenFc,
  baueZonenFc,
  type FlaechenFeatureCollection,
  type ZonenFeatureCollection,
} from '../pages/lagekarte/kartenLayer';
import { zoneStil } from '../pages/lagekarte/zonenStil';

/** Beschriftung einer Abschnittsfläche auf dem Monitor, am Schwerpunkt der Fläche. */
export interface MonitorAbschnittMarke {
  id: number;
  text: string;
  lat: number;
  lon: number;
}

export interface MonitorFlaechen {
  zonen: ZonenFeatureCollection;
  abschnitte: FlaechenFeatureCollection;
  marken: MonitorAbschnittMarke[];
  /** Jeder Stützpunkt, damit der Ausschnitt die Flächen ganz zeigt. */
  stuetzpunkte: { lat: number; lon: number }[];
}

/**
 * Flächen der Monitorkarte (LLH-1153): Gefahrenzonen und Abschnittsflächen aus dem Lagebild, im
 * Stil der Lagekarte (`zoneStil`, Abschnitte über `baueFlaechenFc`), ohne Beschriftung der Zonen —
 * der Server liefert sie nicht. Abschnitte tragen ihre Kurzbezeichnung, sonst die Bezeichnung.
 * Unlesbare Geometrien fallen still weg, wie auf der Lagekarte.
 */
export function baueMonitorFlaechen(
  zonen: readonly LagemonitorZone[],
  abschnitte: readonly LagemonitorAbschnitt[],
): MonitorFlaechen {
  const stuetzpunkte: { lat: number; lon: number }[] = [];
  const merke = (koordinaten: number[][]) => {
    for (const [lon, lat] of koordinaten) stuetzpunkte.push({ lat, lon });
  };

  const zonenFeatures = zonen.flatMap((z) => {
    const geometrie = parseGeometry(z.geometrie);
    if (!geometrie) return [];
    merke(geometrie.type === 'Polygon' ? (geometrie.coordinates[0] ?? []) : geometrie.coordinates);
    return [
      {
        id: z.id,
        geometrie,
        label: null,
        typ: z.typ,
        stil: zoneStil(z.typ, null),
        gestrichelt: z.typ === 'gefahrengebiet',
      },
    ];
  });

  const flaechen: { id: number; label: string; polygon: GeoJsonPolygon }[] = [];
  const marken: MonitorAbschnittMarke[] = [];
  for (const a of abschnitte) {
    const polygon = parsePolygon(a.flaeche_geojson);
    if (!polygon) continue;
    merke(polygon.coordinates[0] ?? []);
    const text = a.kurzbezeichnung?.trim() || a.bezeichnung;
    flaechen.push({ id: a.id, label: text, polygon });
    const mitte = polygonZentroid(polygon);
    if (mitte) marken.push({ id: a.id, text, lon: mitte[0], lat: mitte[1] });
  }

  return {
    zonen: baueZonenFc(zonenFeatures),
    abschnitte: baueFlaechenFc(flaechen),
    marken,
    stuetzpunkte,
  };
}
