import { useEffect, useRef } from 'react';
import maplibregl, { type LngLatLike, type StyleSpecification } from 'maplibre-gl';
import { Protocol } from 'pmtiles';
import { erzeugeTaktischesZeichen } from 'taktische-zeichen-react';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { KarteMarker } from './marker';
import type { GeoJsonPolygon } from './geo';
import { createAbschnittDraw, type AbschnittDraw } from './abschnittDraw';

// pmtiles-Protokoll genau einmal global registrieren.
let pmtilesRegistriert = false;
function registrierePmtiles() {
  if (pmtilesRegistriert) return;
  const protocol = new Protocol();
  maplibregl.addProtocol('pmtiles', protocol.tile);
  pmtilesRegistriert = true;
}

export interface KartenflaecheProps {
  style: StyleSpecification | string;
  markers: KarteMarker[];
  /** Karten-Klick (z. B. zum Platzieren) — liefert geklickte Koordinate. */
  onKarteKlick?: (lngLat: { lng: number; lat: number }) => void;
  /** Marker-Klick → Inspector öffnen. */
  onMarkerKlick?: (schluessel: string) => void;
  /** Beim Setzen sanft hinfliegen. */
  flyToZiel?: { lng: number; lat: number } | null;
  /** Style-Ladefehler (online nicht erreichbar) → Page stuft ab. */
  onStyleFehler?: () => void;
  /** Abschnittsflächen als Polygone rendern (Befehlsstellen-Marker laufen über `markers`). */
  flaechen?: { id: number; label: string; polygon: GeoJsonPolygon }[];
  /** Polygon-Zeichenmodus aktiv. */
  zeichnen?: boolean;
  /** Callback nach abgeschlossenem Zeichnen einer Fläche. */
  onFlaecheGezeichnet?: (polygon: GeoJsonPolygon) => void;
  /** Klick auf eine Abschnittsfläche → Inspector. */
  onFlaecheKlick?: (id: number) => void;
}

type FlaechenFeatureCollection = {
  type: 'FeatureCollection';
  features: {
    type: 'Feature';
    id: number;
    properties: { id: number; label: string };
    geometry: GeoJsonPolygon;
  }[];
};

/** Idempotent: legt Source + fill/line-Layer für Abschnittsflächen an (Style-Wechsel entfernt sie). */
function sorgeFuerAbschnittLayer(map: maplibregl.Map, daten: FlaechenFeatureCollection) {
  if (!map.getSource('abschnitte')) {
    map.addSource('abschnitte', { type: 'geojson', data: daten as never });
  }
  if (!map.getLayer('abschnitte-fill')) {
    map.addLayer({
      id: 'abschnitte-fill',
      type: 'fill',
      source: 'abschnitte',
      paint: { 'fill-color': '#722ed1', 'fill-opacity': 0.15 },
    });
  }
  if (!map.getLayer('abschnitte-line')) {
    map.addLayer({
      id: 'abschnitte-line',
      type: 'line',
      source: 'abschnitte',
      paint: { 'line-color': '#722ed1', 'line-width': 2 },
    });
  }
}

function baueFlaechenFc(flaechen: KartenflaecheProps['flaechen']): FlaechenFeatureCollection {
  return {
    type: 'FeatureCollection',
    features: (flaechen ?? []).map((f) => ({
      type: 'Feature',
      id: f.id,
      properties: { id: f.id, label: f.label },
      geometry: f.polygon,
    })),
  };
}

export default function Kartenflaeche({
  style, markers, onKarteKlick, onMarkerKlick, flyToZiel, onStyleFehler,
  flaechen, zeichnen, onFlaecheGezeichnet, onFlaecheKlick,
}: KartenflaecheProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerObjekteRef = useRef<maplibregl.Marker[]>([]);
  // true, sobald der initiale Style geladen ist → danach gelten error-Events als
  // transient (einzelne Tiles), NICHT als Style-Ladefehler.
  const stilGeladenRef = useRef(false);
  // Aktuelle Flächendaten; nach setStyle ist die Source leer → re-Anlage liest hieraus.
  const flaechenDatenRef = useRef<FlaechenFeatureCollection>(baueFlaechenFc(flaechen));
  // Zeichen-Controller (terra-draw) über Renders hinweg.
  const drawRef = useRef<AbschnittDraw | null>(null);
  // onFlaecheGezeichnet stabil halten, damit eine neue Identität den Draw nicht mitten im Zeichnen neu aufsetzt.
  const onFlaecheGezeichnetRef = useRef(onFlaecheGezeichnet);
  onFlaecheGezeichnetRef.current = onFlaecheGezeichnet;

  // Karte einmalig erzeugen.
  useEffect(() => {
    registrierePmtiles();
    if (!containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style,
      center: [10.45, 51.16], // Mitte DE als neutraler Start
      zoom: 5,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl(), 'top-right');
    map.on('load', () => {
      stilGeladenRef.current = true;
      sorgeFuerAbschnittLayer(map, flaechenDatenRef.current);
    });
    // Nach setStyle (Basemap-/Theme-Wechsel) sind Source/Layer weg → idempotent re-anlegen
    // und die zuletzt bekannten Flächendaten wieder einspielen.
    map.on('styledata', () => {
      if (!map.isStyleLoaded()) return;
      sorgeFuerAbschnittLayer(map, flaechenDatenRef.current);
    });
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Style wechseln (Basemap-Umschalter / Theme). Bewusst KEIN Reset von
  // stilGeladenRef: ein Style-Ladefehler nach manuellem Wechsel wird NICHT über
  // onStyleFehler gemeldet (Reset würde transiente Tile-Errors als Fehler werten).
  useEffect(() => {
    const map = mapRef.current;
    if (map) map.setStyle(style);
  }, [style]);

  // Klick-Handler verdrahten (onKarteKlick kann sich ändern → neu binden).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const handler = (e: maplibregl.MapMouseEvent) => onKarteKlick?.({ lng: e.lngLat.lng, lat: e.lngLat.lat });
    map.on('click', handler);
    // Nur der INITIALE Style-Ladefehler stuft die Basemap ab. MapLibre feuert
    // 'error' auch für einzelne fehlende Tiles — die dürfen den Nutzer nicht aus
    // dem Online-Modus werfen.
    const fehler = () => {
      if (!stilGeladenRef.current) onStyleFehler?.();
    };
    map.on('error', fehler);
    return () => {
      map.off('click', handler);
      map.off('error', fehler);
    };
  }, [onKarteKlick, onStyleFehler]);

  // Marker re-rendern, wenn sich die Liste ändert.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const m of markerObjekteRef.current) m.remove();
    markerObjekteRef.current = markers.map((mk) => {
      const el = document.createElement('div');
      el.title = mk.label;
      el.style.cursor = 'pointer';
      if (mk.tz) {
        // Per DOM-API bauen (kein innerHTML). dataUrl/statusFarbe stammen aus kontrollierten Enum-Werten.
        const { dataUrl } = erzeugeTaktischesZeichen(mk.tz);
        const wrap = document.createElement('div');
        wrap.style.display = 'flex';
        if (mk.statusFarbe) {
          wrap.style.cssText += `border:3px solid ${mk.statusFarbe};border-radius:6px;padding:1px;background:rgba(255,255,255,.85);`;
        }
        const img = document.createElement('img');
        img.src = dataUrl;
        img.width = 34; img.height = 34; img.alt = '';
        wrap.appendChild(img);
        el.appendChild(wrap);
      } else {
        el.style.cssText += `width:18px;height:18px;border-radius:50%;border:2px solid #fff;background:${mk.farbe};box-shadow:0 0 3px rgba(0,0,0,.5)`;
      }
      el.addEventListener('click', (ev) => {
        ev.stopPropagation(); // nicht als Karten-Klick werten
        onMarkerKlick?.(mk.schluessel);
      });
      return new maplibregl.Marker({ element: el }).setLngLat([mk.lon, mk.lat]).addTo(map);
    });
  }, [markers, onMarkerKlick]);

  // fly-to bei Auswahl.
  useEffect(() => {
    const map = mapRef.current;
    if (map && flyToZiel) map.flyTo({ center: [flyToZiel.lng, flyToZiel.lat] as LngLatLike, zoom: 15 });
  }, [flyToZiel]);

  // Abschnittsflächen-Daten in die Source spielen (und für setStyle-Re-Anlage merken).
  useEffect(() => {
    const fc = baueFlaechenFc(flaechen);
    flaechenDatenRef.current = fc; // unbedingt: load/styledata-Handler lesen daraus
    const map = mapRef.current;
    // Vor Style-Load würden addSource/addLayer werfen ("Style is not done loading");
    // die initiale Anlage übernimmt der load-Handler aus flaechenDatenRef.
    if (!map || !map.isStyleLoaded()) return;
    sorgeFuerAbschnittLayer(map, fc); // legt Source/Layer an, falls noch nicht vorhanden
    const src = map.getSource('abschnitte') as maplibregl.GeoJSONSource | undefined;
    if (src) src.setData(fc as never);
  }, [flaechen]);

  // Klick auf eine Fläche → Inspector.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const handler = (e: maplibregl.MapLayerMouseEvent) => {
      const id = e.features?.[0]?.properties?.id;
      if (id != null) onFlaecheKlick?.(Number(id));
    };
    map.on('click', 'abschnitte-fill', handler);
    return () => { map.off('click', 'abschnitte-fill', handler); };
  }, [onFlaecheKlick]);

  // Zeichenmodus an-/abschalten; Controller-Lifecycle über drawRef.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (zeichnen) {
      if (!drawRef.current) {
        drawRef.current = createAbschnittDraw(map, (poly) => onFlaecheGezeichnetRef.current?.(poly));
      }
      drawRef.current.starten();
    } else if (drawRef.current) {
      drawRef.current.stoppen();
    }
  }, [zeichnen]);

  // Controller bei Unmount sauber zerstören.
  useEffect(() => () => {
    drawRef.current?.zerstoeren();
    drawRef.current = null;
  }, []);

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} data-testid="kartenflaeche" />;
}
