/**
 * Kreis um einen Punkt (LLH-1043, design.md D5/D6): Vorschau des laufenden Kreises und der
 * Radius-Griff. Ohne terra-draw: dessen Kreis-Modus nimmt der Karte im Zieh-Zug jedes Verschieben
 * und geht am Touchschirm im Klick-Zug nicht (kein Hover). Gespeichert wird das Polygon des
 * Servers; hier wird nur gezeigt.
 *
 * Die Ebenen tragen den Präfix `td-` wie jede Zeichnung: die Eigenposition legt sich darunter
 * (`ordneEigenpositionEin`, LFH-766). Sie sind keine Klickebene (keine Rolle in
 * `ordneKlickebene`): ein Tipp im Kreis-Modus setzt die Mitte, egal was darunter liegt.
 */
import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
import { abstandM, kreisPolygon, radiusPunkt, type GeoPunkt } from './geo';
import { griffStil, type GriffKontext } from './bildGriffe';
import { KREIS_RADIUS_M_MAX } from '../../api/eingabegrenzen';

export const KREIS_VORSCHAU_QUELLE = 'td-zone-kreis';
export const KREIS_VORSCHAU_LAYER = [
  'td-zone-kreis-flaeche',
  'td-zone-kreis-linie',
  'td-zone-kreis-mitte',
] as const;

/** Was die Vorschau zeigt: Mitte und Radius, beide offen; Farbe der Zonenart. */
export interface KreisVorschau {
  mitte: GeoPunkt | null;
  radiusM: number | null;
  farbe: string;
}

type Fc = {
  type: 'FeatureCollection';
  features: {
    type: 'Feature';
    properties: { teil: 'kreis' | 'mitte' };
    geometry: { type: string; coordinates: unknown };
  }[];
};

/** Features der Vorschau: die Kreisfläche (mit Radius) und der Mittelpunkt (mit Mitte). Rein. */
export function kreisVorschauDaten(v: Pick<KreisVorschau, 'mitte' | 'radiusM'> | null): Fc {
  const features: Fc['features'] = [];
  if (v?.mitte) {
    if (v.radiusM != null && v.radiusM > 0) {
      features.push({
        type: 'Feature',
        properties: { teil: 'kreis' },
        geometry: kreisPolygon(v.mitte, v.radiusM),
      });
    }
    features.push({
      type: 'Feature',
      properties: { teil: 'mitte' },
      geometry: { type: 'Point', coordinates: [v.mitte.lon, v.mitte.lat] },
    });
  }
  return { type: 'FeatureCollection', features };
}

/**
 * Quelle und Ebenen idempotent anlegen und die Daten einspielen. Ohne Kreis und ohne angelegte
 * Quelle bleibt die Karte unberührt. Gestrichelt: ein Entwurf, noch keine Zone.
 */
export function sorgeFuerKreisVorschau(map: MapLibreMap, v: KreisVorschau | null): void {
  const daten = kreisVorschauDaten(v);
  const quelle = map.getSource(KREIS_VORSCHAU_QUELLE) as GeoJSONSource | undefined;
  if (!quelle && daten.features.length === 0) return;
  if (quelle) quelle.setData(daten as never);
  else map.addSource(KREIS_VORSCHAU_QUELLE, { type: 'geojson', data: daten as never });
  const farbe = v?.farbe ?? '#000';
  const layer: Record<(typeof KREIS_VORSCHAU_LAYER)[number], object> = {
    'td-zone-kreis-flaeche': {
      type: 'fill',
      filter: ['==', ['get', 'teil'], 'kreis'],
      paint: { 'fill-color': farbe, 'fill-opacity': 0.15 },
    },
    'td-zone-kreis-linie': {
      type: 'line',
      filter: ['==', ['get', 'teil'], 'kreis'],
      paint: { 'line-color': farbe, 'line-width': 3, 'line-dasharray': [2, 1] },
    },
    'td-zone-kreis-mitte': {
      type: 'circle',
      filter: ['==', ['get', 'teil'], 'mitte'],
      paint: {
        'circle-radius': 5,
        'circle-color': farbe,
        'circle-stroke-color': '#fff',
        'circle-stroke-width': 2,
      },
    },
  };
  for (const id of KREIS_VORSCHAU_LAYER) {
    if (map.getLayer(id)) {
      // Die Farbe folgt der Zonenart, die im Band wechseln kann.
      const art = (layer[id] as { type: string }).type;
      const eigenschaft =
        art === 'fill' ? 'fill-color' : art === 'line' ? 'line-color' : 'circle-color';
      map.setPaintProperty(id, eigenschaft, farbe);
    } else {
      map.addLayer({ id, source: KREIS_VORSCHAU_QUELLE, ...layer[id] } as never);
    }
  }
}

/** Ebenen und Quelle entfernen (Modusende). */
export function entferneKreisVorschau(map: MapLibreMap): void {
  for (const id of KREIS_VORSCHAU_LAYER) if (map.getLayer(id)) map.removeLayer(id);
  if (map.getSource(KREIS_VORSCHAU_QUELLE)) map.removeSource(KREIS_VORSCHAU_QUELLE);
}

/**
 * Radius aus der Lage des Griffs: Großkreisabstand zur Mitte, auf ganze Meter gerundet und in
 * (0, `KREIS_RADIUS_M_MAX`] gehalten. Rein.
 */
export function radiusAusGriff(mitte: GeoPunkt, griff: GeoPunkt): number {
  const r = Math.round(abstandM(mitte, griff));
  return Math.min(Math.max(r, 1), KREIS_RADIUS_M_MAX);
}

/** Wo der Griff sitzt: ohne Radius auf der Mitte (Ziehen beginnt den Kreis), sonst im Osten. */
export function griffLage(mitte: GeoPunkt, radiusM: number | null): GeoPunkt {
  return radiusM != null && radiusM > 0 ? radiusPunkt(mitte, radiusM) : mitte;
}

export interface KreisGriff {
  /** Lage nachführen (Mitte/Radius geändert); ohne Mitte hängt der Griff nicht an der Karte. */
  setze(mitte: GeoPunkt | null, radiusM: number | null): void;
  zerstoeren(): void;
}

/**
 * Der Radius-Griff (D6): ein ziehbarer `maplibregl.Marker` wie die Bild-Griffe (`bildHandles.ts`),
 * Ziel mindestens 44 px. Ziehen meldet den Radius laufend (`fertig = false`) und am Ende einmal mit
 * `fertig = true`. Die Karte bleibt außerhalb des Griffs verschiebbar.
 */
export function erzeugeKreisGriff(
  map: MapLibreMap,
  kontext: GriffKontext,
  onRadius: (radiusM: number, fertig: boolean) => void,
): KreisGriff {
  const { container, kern } = griffStil('kante', kontext);
  const el = document.createElement('div');
  el.style.cssText = container;
  el.dataset.lfh = 'kreisgriff';
  el.setAttribute('aria-hidden', 'true');
  const innen = document.createElement('div');
  innen.style.cssText = kern;
  el.appendChild(innen);
  // Ein Tipp auf den Griff ist kein Tipp auf die Karte: er versetzte sonst die Mitte an den Rand.
  el.addEventListener('click', (e) => e.stopPropagation());
  const marker = new maplibregl.Marker({ element: el, draggable: true });
  let mitte: GeoPunkt | null = null;
  let dran = false;
  let ziehend = false;

  const radiusJetzt = () => {
    const ll = marker.getLngLat();
    return mitte ? radiusAusGriff(mitte, { lat: ll.lat, lon: ll.lng }) : null;
  };
  marker.on('dragstart', () => {
    ziehend = true;
  });
  marker.on('drag', () => {
    const r = radiusJetzt();
    if (r != null) onRadius(r, false);
  });
  marker.on('dragend', () => {
    ziehend = false;
    const r = radiusJetzt();
    if (r != null) onRadius(r, true);
  });

  return {
    setze(m, radiusM) {
      mitte = m;
      if (!m) {
        if (dran) marker.remove();
        dran = false;
        return;
      }
      // Mitten im Zug setzt der Zeiger die Lage, nicht der gemeldete Radius.
      if (!ziehend) {
        const p = griffLage(m, radiusM);
        marker.setLngLat([p.lon, p.lat]);
      }
      if (!dran) {
        marker.addTo(map);
        dran = true;
      }
    },
    zerstoeren() {
      marker.remove();
      dran = false;
    },
  };
}
