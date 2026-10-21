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

/**
 * Quelle und Ebenen einer Kreis-Vorschau. Zwei Sätze teilen dieselbe Zeichnung: der Kreis um einen
 * Punkt (Zone) und der Vorschaukreis der Messform „Radius“ (LLH-1345). Getrennte Ebenen, damit der
 * Abbau der einen die andere nie trifft.
 */
export interface KreisEbenen {
  quelle: string;
  flaeche: string;
  linie: string;
  /** Punkt in der Mitte; ohne ihn keine Mittel-Ebene (die Messung zeichnet ihre Punkte selbst). */
  mitte?: string;
  /**
   * Die Ebenen liegen unter der ersten fremden Ebene mit diesem Präfix (die Zeichnung von
   * terra-draw bleibt oben); ohne ihn oder ohne solche Ebene oben auf.
   */
  unterPraefix?: string;
}

export const KREIS_VORSCHAU_EBENEN: KreisEbenen = {
  quelle: 'td-zone-kreis',
  flaeche: 'td-zone-kreis-flaeche',
  linie: 'td-zone-kreis-linie',
  mitte: 'td-zone-kreis-mitte',
};

/** Vorschaukreis der Messung (LLH-1345), unter Linie und Punkten der Mess-Zeichnung (`td-mess`). */
export const MESS_KREIS_EBENEN: KreisEbenen = {
  quelle: 'td-mess-kreis',
  flaeche: 'td-mess-kreis-flaeche',
  linie: 'td-mess-kreis-linie',
  unterPraefix: 'td-mess-',
};

const ebenenIds = (e: KreisEbenen): string[] =>
  e.mitte ? [e.flaeche, e.linie, e.mitte] : [e.flaeche, e.linie];

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
export function sorgeFuerKreisVorschau(
  map: MapLibreMap,
  v: KreisVorschau | null,
  ebenen: KreisEbenen = KREIS_VORSCHAU_EBENEN,
): void {
  const daten = kreisVorschauDaten(v);
  const quelle = map.getSource(ebenen.quelle) as GeoJSONSource | undefined;
  if (!quelle && daten.features.length === 0) return;
  if (quelle) quelle.setData(daten as never);
  else map.addSource(ebenen.quelle, { type: 'geojson', data: daten as never });
  const farbe = v?.farbe ?? '#000';
  const layer = new Map<string, { type: string; filter: unknown; paint: object }>([
    [
      ebenen.flaeche,
      {
        type: 'fill',
        filter: ['==', ['get', 'teil'], 'kreis'],
        paint: { 'fill-color': farbe, 'fill-opacity': 0.15 },
      },
    ],
    [
      ebenen.linie,
      {
        type: 'line',
        filter: ['==', ['get', 'teil'], 'kreis'],
        paint: { 'line-color': farbe, 'line-width': 3, 'line-dasharray': [2, 1] },
      },
    ],
  ]);
  if (ebenen.mitte)
    layer.set(ebenen.mitte, {
      type: 'circle',
      filter: ['==', ['get', 'teil'], 'mitte'],
      paint: {
        'circle-radius': 5,
        'circle-color': farbe,
        'circle-stroke-color': '#fff',
        'circle-stroke-width': 2,
      },
    });
  const ids = ebenenIds(ebenen);
  // Nur beim Anlegen gesucht: `getStyle()` serialisiert den ganzen Stil.
  const vor = (): string | undefined =>
    ebenen.unterPraefix
      ? map
          .getStyle()
          ?.layers?.find((l) => l.id.startsWith(ebenen.unterPraefix!) && !ids.includes(l.id))?.id
      : undefined;
  for (const [id, def] of layer) {
    if (map.getLayer(id)) {
      // Die Farbe folgt der Zonenart, die im Band wechseln kann.
      const eigenschaft =
        def.type === 'fill' ? 'fill-color' : def.type === 'line' ? 'line-color' : 'circle-color';
      map.setPaintProperty(id, eigenschaft, farbe);
    } else {
      map.addLayer({ id, source: ebenen.quelle, ...def } as never, vor());
    }
  }
}

/** Ebenen und Quelle entfernen (Modusende). */
export function entferneKreisVorschau(
  map: MapLibreMap,
  ebenen: KreisEbenen = KREIS_VORSCHAU_EBENEN,
): void {
  for (const id of ebenenIds(ebenen)) if (map.getLayer(id)) map.removeLayer(id);
  if (map.getSource(ebenen.quelle)) map.removeSource(ebenen.quelle);
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

/**
 * Steht der Mittengriff (LLH-1344, design.md D3)? Nur mit Mitte UND Radius: ohne Radius sitzt der
 * Randgriff auf der Mitte, zwei Griffe übereinander teilten sich einen Tipp.
 */
export function mittenGriffSteht(mitte: GeoPunkt | null, radiusM: number | null): boolean {
  return mitte != null && radiusM != null && radiusM > 0;
}

export interface KreisGriff {
  /** Lage nachführen (Mitte/Radius geändert); ohne Mitte hängt der Griff nicht an der Karte. */
  setze(mitte: GeoPunkt | null, radiusM: number | null): void;
  zerstoeren(): void;
}

/** Ein Griff-Element (Ziel ≥ 44 px, sichtbarer Kern); ein Tipp darauf ist kein Tipp auf die Karte. */
function griffElement(art: 'kante' | 'mitte', kontext: GriffKontext, kennung: string): HTMLElement {
  const { container, kern } = griffStil(art, kontext);
  const el = document.createElement('div');
  el.style.cssText = container;
  el.dataset.lfh = kennung;
  el.setAttribute('aria-hidden', 'true');
  const innen = document.createElement('div');
  innen.style.cssText = kern;
  el.appendChild(innen);
  // Ein Tipp auf den Griff ist kein Tipp auf die Karte: er versetzte sonst die Mitte.
  el.addEventListener('click', (e) => e.stopPropagation());
  return el;
}

/**
 * Der Radius-Griff (D6): ein ziehbarer `maplibregl.Marker` wie die Bild-Griffe (`bildHandles.ts`),
 * Ziel mindestens 44 px. Ziehen meldet den Radius laufend (`fertig = false`) und am Ende einmal mit
 * `fertig = true`. Die Karte bleibt außerhalb des Griffs verschiebbar.
 *
 * Mit `onMitte` steht zusätzlich ein Mittengriff (LLH-1344, design.md D3), sobald ein Radius
 * steht ({@link mittenGriffSteht}): Ziehen versetzt die Mitte laufend, der Radius bleibt.
 */
export function erzeugeKreisGriff(
  map: MapLibreMap,
  kontext: GriffKontext,
  onRadius: (radiusM: number, fertig: boolean) => void,
  onMitte?: (mitte: GeoPunkt, fertig: boolean) => void,
): KreisGriff {
  const marker = new maplibregl.Marker({
    element: griffElement('kante', kontext, 'kreisgriff'),
    draggable: true,
  });
  const mittenMarker = new maplibregl.Marker({
    element: griffElement('mitte', kontext, 'kreisgriff-mitte'),
    draggable: true,
  });
  let mitte: GeoPunkt | null = null;
  let radius: number | null = null;
  let dran = false;
  let mitteDran = false;
  let ziehend = false;
  let mitteZiehend = false;
  const mitteJetzt = (): GeoPunkt => {
    const ll = mittenMarker.getLngLat();
    return { lat: ll.lat, lon: ll.lng };
  };
  mittenMarker.on('dragstart', () => {
    mitteZiehend = true;
  });
  mittenMarker.on('drag', () => onMitte?.(mitteJetzt(), false));
  mittenMarker.on('dragend', () => {
    mitteZiehend = false;
    onMitte?.(mitteJetzt(), true);
  });

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

  const setzeMitte = () => {
    const steht = onMitte != null && mittenGriffSteht(mitte, radius);
    if (!steht || !mitte) {
      if (mitteDran) mittenMarker.remove();
      mitteDran = false;
      return;
    }
    if (!mitteZiehend) mittenMarker.setLngLat([mitte.lon, mitte.lat]);
    if (!mitteDran) {
      mittenMarker.addTo(map);
      mitteDran = true;
    }
  };

  return {
    setze(m, radiusM) {
      mitte = m;
      radius = radiusM;
      setzeMitte();
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
      mittenMarker.remove();
      dran = false;
      mitteDran = false;
    },
  };
}
