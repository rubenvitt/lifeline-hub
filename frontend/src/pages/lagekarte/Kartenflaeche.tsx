import { useEffect, useRef } from 'react';
import maplibregl, { type LngLatLike, type StyleSpecification } from 'maplibre-gl';
import { Protocol } from 'pmtiles';
import { erzeugeTaktischesZeichen } from 'taktische-zeichen-react';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { KarteMarker } from './marker';
import type { GeoJsonPolygon, GeoJsonGeometry } from './geo';
import { createZeichnung, type Zeichnung, type ZeichenModus } from './zeichnen';
import { wendeKartenDatenAn } from './kartenDaten';
import {
  baueFlaechenFc,
  baueZonenFc,
  planeReAnlegenNachStyle,
  sorgeFuerAbschnittLayer,
  sorgeFuerZonenLayer,
  type FlaechenFeatureCollection,
  type ZonenFeatureCollection,
  type ZoneFeature,
} from './kartenLayer';

// Re-Export: LagekartePage importiert ZoneFeature weiterhin aus Kartenflaeche.
export type { ZoneFeature };

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
  /** Config-autoritative Pflicht-Attribution des aktiven Online-Views (null = keine). */
  attribution?: string | null;
  /** Abschnittsflächen als Polygone rendern (Befehlsstellen-Marker laufen über `markers`). */
  flaechen?: { id: number; label: string; polygon: GeoJsonPolygon }[];
  /** Polygon-Zeichenmodus aktiv. */
  zeichnen?: boolean;
  /** Callback nach abgeschlossenem Zeichnen einer Fläche. */
  onFlaecheGezeichnet?: (polygon: GeoJsonPolygon) => void;
  /** Klick auf eine Abschnittsfläche → Inspector. */
  onFlaecheKlick?: (id: number) => void;
  /** Gefahren-/Absperrzonen (Flächen + Linien) mit aufgelöstem Stil. */
  zonen?: ZoneFeature[];
  /** Zonen-Zeichenmodus (Polygon/Linie) aktiv. */
  zoneZeichnen?: ZeichenModus | null;
  /** Callback nach abgeschlossenem Zeichnen einer Zone. */
  onZoneGezeichnet?: (geometrie: GeoJsonGeometry) => void;
  /** Klick auf eine Zone → Inspector. */
  onZoneKlick?: (id: number) => void;
}

export default function Kartenflaeche({
  style, markers, onKarteKlick, onMarkerKlick, flyToZiel, onStyleFehler, attribution,
  flaechen, zeichnen, onFlaecheGezeichnet, onFlaecheKlick,
  zonen, zoneZeichnen, onZoneGezeichnet, onZoneKlick,
}: KartenflaecheProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerObjekteRef = useRef<maplibregl.Marker[]>([]);
  // true, sobald der initiale Style geladen ist → danach gelten error-Events als
  // transient (einzelne Tiles), NICHT als Style-Ladefehler.
  const stilGeladenRef = useRef(false);
  // Eigene AttributionControl (statt der eingebauten), damit customAttribution je View
  // gesetzt werden kann. Wird bei Attribution-Wechsel entfernt und neu hinzugefügt.
  const attribControlRef = useRef<maplibregl.AttributionControl | null>(null);
  // Aktuelle Flächendaten; nach setStyle ist die Source leer → re-Anlage liest hieraus.
  const flaechenDatenRef = useRef<FlaechenFeatureCollection>(baueFlaechenFc(flaechen));
  // Aktuelle Zonendaten; analog flaechenDatenRef für die Re-Anlage nach setStyle.
  const zonenDatenRef = useRef<ZonenFeatureCollection>(baueZonenFc(zonen));
  // Zuletzt angewandter Style. Der Konstruktor wendet den initialen Style an → der
  // [style]-Effekt soll NUR auf echte Wechsel reagieren (sonst lädt diff:false beim
  // Mount den Style unnötig komplett neu).
  const angewandterStyleRef = useRef(style);
  // Zeichen-Controller (terra-draw) über Renders hinweg.
  const drawRef = useRef<Zeichnung | null>(null);
  // Eigener Zeichen-Controller für Zonen (Polygon ODER Linie).
  const zoneDrawRef = useRef<Zeichnung | null>(null);
  // onFlaecheGezeichnet stabil halten, damit eine neue Identität den Draw nicht mitten im Zeichnen neu aufsetzt.
  const onFlaecheGezeichnetRef = useRef(onFlaecheGezeichnet);
  onFlaecheGezeichnetRef.current = onFlaecheGezeichnet;
  const onZoneGezeichnetRef = useRef(onZoneGezeichnet);
  onZoneGezeichnetRef.current = onZoneGezeichnet;

  // Karte einmalig erzeugen.
  useEffect(() => {
    registrierePmtiles();
    if (!containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style,
      center: [10.45, 51.16], // Mitte DE als neutraler Start
      zoom: 5,
      attributionControl: false,
    });
    map.addControl(new maplibregl.NavigationControl(), 'top-right');
    map.on('load', () => {
      stilGeladenRef.current = true;
      sorgeFuerAbschnittLayer(map, flaechenDatenRef.current);
      sorgeFuerZonenLayer(map, zonenDatenRef.current);
    });
    mapRef.current = map;
    return () => {
      map.remove(); // zerstört auch die AttributionControl
      mapRef.current = null;
      // Ref nullen: sonst sieht der Attribution-Effekt nach StrictMode-Remount eine
      // stale Control der entfernten Map und ruft removeControl auf bereits Zerstörtem.
      attribControlRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Style wechseln (Basemap-Umschalter / Theme). Bewusst KEIN Reset von
  // stilGeladenRef: ein Style-Ladefehler nach manuellem Wechsel wird NICHT über
  // onStyleFehler gemeldet (Reset würde transiente Tile-Errors als Fehler werten).
  //
  // WICHTIG `diff: false`: per Default difft setStyle und ist bei URL-/Vektor-Styles
  // ASYNCHRON (erst Fetch, dann Diff). In diesem Fenster liefert isStyleLoaded() noch
  // den ALTEN Style als „geladen" → der render-Poll würde zu früh laufen (Sources noch
  // da, No-Op), und der nachgelagerte Diff wischt unsere Layer weg → Zeichnungen
  // verschwinden NUR bei Vektor-Basemaps. `diff: false` setzt synchron einen frischen,
  // ungeladenen Style (isStyleLoaded() sofort false) → der Poll vertagt zuverlässig auf
  // den ersten geladenen Frame und legt Abschnitte/Zonen neu an — für ALLE Style-Typen.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (style === angewandterStyleRef.current) return; // Mount: Konstruktor hat ihn schon
    angewandterStyleRef.current = style;
    map.setStyle(style, { diff: false });
    planeReAnlegenNachStyle(map, () => flaechenDatenRef.current, () => zonenDatenRef.current);
  }, [style]);

  // AttributionControl je nach aktivem View neu setzen (config-autoritativ). MapLibre
  // bietet keinen Setter für customAttribution → Control entfernen und neu anlegen.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (attribControlRef.current) {
      map.removeControl(attribControlRef.current);
      attribControlRef.current = null;
    }
    const ctrl = new maplibregl.AttributionControl({
      compact: true,
      customAttribution: attribution ?? '',
    });
    map.addControl(ctrl);
    attribControlRef.current = ctrl;
  }, [attribution]);

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
    flaechenDatenRef.current = fc; // unbedingt: load/styledata/idle-Handler lesen daraus
    const map = mapRef.current;
    if (!map) return;
    // Style noch nicht geladen → Anwendung auf das nächste idle vertagen (sonst ginge
    // eine frisch gezeichnete Fläche bis zum Reload verloren). Immer aus dem Ref lesen,
    // damit ein vertagter Lauf die zuletzt bekannten Daten einspielt.
    wendeKartenDatenAn(map, () => {
      sorgeFuerAbschnittLayer(map, flaechenDatenRef.current);
      const src = map.getSource('abschnitte') as maplibregl.GeoJSONSource | undefined;
      if (src) src.setData(flaechenDatenRef.current as never);
    });
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

  // Zonendaten in die Source spielen (und für setStyle-Re-Anlage merken).
  useEffect(() => {
    const fc = baueZonenFc(zonen);
    zonenDatenRef.current = fc; // unbedingt: load/styledata/idle-Handler lesen daraus
    const map = mapRef.current;
    if (!map) return;
    // Style noch nicht geladen (z. B. während terra-draw seine Zeichen-Layer auf-/abbaut)
    // → Anwendung auf das nächste idle vertagen, sonst bliebe die frisch gezeichnete Zone
    // bis zum Reload unsichtbar. Immer aus dem Ref lesen → vertagter Lauf nutzt die
    // aktuellsten Daten.
    wendeKartenDatenAn(map, () => {
      sorgeFuerZonenLayer(map, zonenDatenRef.current);
      const src = map.getSource('zonen') as maplibregl.GeoJSONSource | undefined;
      if (src) src.setData(zonenDatenRef.current as never);
    });
  }, [zonen]);

  // Klick auf eine Zone (Fläche ODER Linie) → Inspector.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const handler = (e: maplibregl.MapLayerMouseEvent) => {
      const id = e.features?.[0]?.properties?.id;
      if (id != null) onZoneKlick?.(Number(id));
    };
    map.on('click', 'zonen-fill', handler);
    map.on('click', 'zonen-line', handler);
    return () => {
      map.off('click', 'zonen-fill', handler);
      map.off('click', 'zonen-line', handler);
    };
  }, [onZoneKlick]);

  // Zeichenmodus an-/abschalten; Controller-Lifecycle über drawRef.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (zeichnen) {
      if (!drawRef.current) {
        drawRef.current = createZeichnung(map, (g) => {
          if (g.type === 'Polygon') onFlaecheGezeichnetRef.current?.(g);
        });
      }
      drawRef.current.starten('polygon');
    } else if (drawRef.current) {
      drawRef.current.stoppen();
    }
  }, [zeichnen]);

  // Zonen-Zeichenmodus (Polygon/Linie) an-/abschalten; eigener Controller-Lifecycle.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (zoneZeichnen) {
      if (!zoneDrawRef.current) {
        zoneDrawRef.current = createZeichnung(map, (g) => onZoneGezeichnetRef.current?.(g));
      }
      zoneDrawRef.current.starten(zoneZeichnen);
    } else if (zoneDrawRef.current) {
      zoneDrawRef.current.stoppen();
    }
  }, [zoneZeichnen]);

  // Controller bei Unmount sauber zerstören.
  useEffect(() => () => {
    drawRef.current?.zerstoeren();
    drawRef.current = null;
    zoneDrawRef.current?.zerstoeren();
    zoneDrawRef.current = null;
  }, []);

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} data-testid="kartenflaeche" />;
}
