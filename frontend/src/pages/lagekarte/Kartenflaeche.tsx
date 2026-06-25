import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import maplibregl, { type LngLatLike, type StyleSpecification, type GeoJSONSource } from 'maplibre-gl';
import { Protocol } from 'pmtiles';
import { erzeugeTaktischesZeichen } from 'taktische-zeichen-react';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { KarteMarker } from './marker';
import {
  baueMarkerFc, baueEinsatzortFc, reAnlegenMarker,
  MARKER_CLUSTER_QUELLE, MARKER_KLICK_LAYER, CLUSTER_LAYER,
  type MarkerFeatureCollection,
} from './markerLayer';
import { tzIconKey } from './markerIcons';
import type { TzProps } from './taktischesZeichen';
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
  type AktiveFachebene,
} from './kartenLayer';
import {
  sorgeFuerFachebeneLayer,
  setzeFachebeneDaten,
  entferneFachebeneLayer,
  fachebeneClickLayerId,
} from './fachebenenLayer';
import { synchronisiereBildLayer, entferneBildLayer, type BildOverlay } from './bildLayer';
import { eckenInitialPixel, type Punkt } from './bildGeometrie';
import { erzeugeBildHandles, type BildHandles } from './bildHandles';
import type { Ecken } from '../../api/kartenbilder';
import { KRITIS_MIN_ZOOM } from './fachebenen';
import type { FachebeneQuelle } from '../../api/fachebenen';

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
  /** Aktive Fachebenen mit Daten (externe Overlays). */
  fachebenen?: AktiveFachebene[];
  /** Bild-Hintergründe (Overlays über der Basemap, unter Abschnitten/Zonen/Markern). */
  bilder?: BildOverlay[];
  /** Karten-Viewport (west,sued,ost,nord) nach Bewegung — für bbox-abhängige Ebenen. */
  onBboxAenderung?: (bbox: string) => void;
  /** Aktuelles Zoom-Level nach Bewegung — z. B. um „näher heranzoomen"-Hinweise zu steuern. */
  onZoomAenderung?: (zoom: number) => void;
  /** Klick auf ein Fachebenen-Objekt → liefert dessen Properties + Quelle (für Detail-Panel). */
  onFachebeneKlick?: (properties: Record<string, unknown>, quelle: FachebeneQuelle) => void;
  /** Aktiv zu platzierendes Bild (null = kein Platzier-Modus). Zeigt Mittelpunkt-Drag-Handle. */
  platzierBild?: { id: number; ecken: Ecken } | null;
  /** Callback, wenn Platzier-Geometrie per Drag verändert wurde. */
  onPlatzierGeometrie?: (ecken: Ecken) => void;
}

/** Imperative Karten-API für die Page: Upload-Platzierung + Auf-Bild-Zentrieren. */
export interface KartenHandle {
  /** Initiale Bild-Ecken für einen Upload: achsenparalleles Rechteck mittig im
   *  aktuellen Viewport, Breite ~50 % der kürzeren View-Kante, Seitenverhältnis = `ar`. */
  initialeEckenFuerBild(ar: number): Ecken | null;
  /** Karte auf die Bild-Ecken einpassen (fitBounds). */
  zentriereAufEcken(ecken: Ecken): void;
}

const Kartenflaeche = forwardRef<KartenHandle, KartenflaecheProps>(function Kartenflaeche({
  style, markers, onKarteKlick, onMarkerKlick, flyToZiel, onStyleFehler, attribution,
  flaechen, zeichnen, onFlaecheGezeichnet, onFlaecheKlick,
  zonen, zoneZeichnen, onZoneGezeichnet, onZoneKlick,
  fachebenen, onBboxAenderung, onZoomAenderung, onFachebeneKlick,
  bilder, platzierBild, onPlatzierGeometrie,
}, ref) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  // Aktuelle Marker-Daten als FeatureCollections; nach setStyle re-angelegt (analog flaechenDatenRef).
  const markerDatenRef = useRef<MarkerFeatureCollection>({ type: 'FeatureCollection', features: [] });
  const einsatzortDatenRef = useRef<MarkerFeatureCollection>({ type: 'FeatureCollection', features: [] });
  // Image-Key → TzProps; der styleimagemissing-Handler erzeugt daraus lazy die Karten-Icons.
  const tzRegistryRef = useRef<Map<string, TzProps>>(new Map());
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
  // Aktuelle Fachebenen; nach setStyle re-angelegt.
  const fachebenenRef = useRef<AktiveFachebene[]>(fachebenen ?? []);
  fachebenenRef.current = fachebenen ?? [];
  // Aktuelle Bild-Overlays; nach setStyle re-angelegt.
  const bilderRef = useRef<BildOverlay[]>([]);
  const vorherigeBilderRef = useRef<Set<number>>(new Set());
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

  // Imperative API für die Page: Upload-Platzierung (Viewport-Mitte, Bild-Seitenverhältnis)
  // und Auf-Bild-Zentrieren. Pixel-Raum via project/unproject → exakt, ohne cos(lat)-Verzerrung.
  useImperativeHandle(ref, () => ({
    initialeEckenFuerBild(ar) {
      const map = mapRef.current;
      if (!map) return null;
      const el = map.getContainer();
      const mittePx: Punkt = [el.clientWidth / 2, el.clientHeight / 2];
      const breitePx = Math.min(el.clientWidth, el.clientHeight) * 0.5;
      const px = eckenInitialPixel(mittePx, breitePx, ar > 0 ? ar : 1);
      return px.map((p) => {
        const ll = map.unproject(p);
        return [ll.lng, ll.lat];
      }) as Ecken;
    },
    zentriereAufEcken(ecken) {
      const map = mapRef.current;
      if (!map) return;
      const b = new maplibregl.LngLatBounds();
      for (const e of ecken) b.extend(e as [number, number]);
      map.fitBounds(b, { padding: 60, maxZoom: 18, duration: 600 });
    },
  }), []);

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
      for (const fe of fachebenenRef.current) {
        sorgeFuerFachebeneLayer(map, fe.def, fe.daten);
      }
      synchronisiereBildLayer(map, bilderRef.current, 'abschnitte-fill');
    });
    // Taktische Zeichen lazy als Karten-Icons: MapLibre meldet fehlende icon-image-IDs; wir rendern
    // das TZ on-demand und registrieren es. Race-Guard, weil das Event während des async Bild-Ladens
    // mehrfach für dieselbe ID feuern kann (sonst wirft addImage "image already exists").
    const ladendeIcons = new Set<string>();
    map.on('styleimagemissing', (e) => {
      const id = e.id;
      if (!id.startsWith('tz|')) return;             // fremde IDs ignorieren
      if (map.hasImage(id) || ladendeIcons.has(id)) return;
      const tz = tzRegistryRef.current.get(id);
      if (!tz) return;
      ladendeIcons.add(id);
      const { dataUrl, size } = erzeugeTaktischesZeichen(tz);
      const img = new Image(size[0], size[1]);
      img.onload = () => {
        // Auf einheitliche Marker-Größe normieren: pixelRatio so, dass die größere Symboldimension
        // ~ZIEL_PX wird (TZ-SVGs haben je Grundzeichen abweichende size). Erst dadurch deckt der
        // feste Status-Ring-Radius (markerLayer.ts, radius:20=40px) das Symbol verlässlich ab.
        const ZIEL_PX = 34;
        const pixelRatio = Math.max(size[0], size[1]) / ZIEL_PX;
        if (!map.hasImage(id)) map.addImage(id, img, { pixelRatio });
        ladendeIcons.delete(id);
      };
      img.onerror = () => { ladendeIcons.delete(id); };
      img.src = dataUrl;
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
    planeReAnlegenNachStyle(
      map,
      () => flaechenDatenRef.current,
      () => zonenDatenRef.current,
      () => fachebenenRef.current,
      () => bilderRef.current,
      () => markerDatenRef.current,
      () => einsatzortDatenRef.current,
    );
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

  // Aktive Fachebenen rendern: Source/Layer sicherstellen, Daten einspielen,
  // inaktive entfernen. Vertagt über wendeKartenDatenAn (Style evtl. nicht geladen).
  const vorherigeFachebenenRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const aktiv = fachebenen ?? [];
    fachebenenRef.current = aktiv;
    wendeKartenDatenAn(map, () => {
      const aktivKeys = new Set(aktiv.map((f) => f.def.key));
      // entfernte Ebenen abbauen
      for (const key of vorherigeFachebenenRef.current) {
        if (!aktivKeys.has(key as never)) entferneFachebeneLayer(map, key as never);
      }
      // aktive an-/nachlegen + Daten setzen
      for (const fe of aktiv) {
        sorgeFuerFachebeneLayer(map, fe.def, fe.daten);
        setzeFachebeneDaten(map, fe.def.key, fe.daten);
      }
      vorherigeFachebenenRef.current = aktivKeys as Set<string>;
    });
  }, [fachebenen]);

  // Bild-Overlays synchronisieren: anlegen/aktualisieren/entfernen.
  // Analog zum Fachebenen-Effekt; beforeId='abschnitte-fill' hält Bilder unter den Vektorlayern.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const aktiv = bilder ?? [];
    bilderRef.current = aktiv;
    wendeKartenDatenAn(map, () => {
      const aktivIds = synchronisiereBildLayer(map, aktiv, 'abschnitte-fill');
      for (const id of vorherigeBilderRef.current) {
        if (!aktivIds.has(id)) entferneBildLayer(map, id);
      }
      vorherigeBilderRef.current = aktivIds;
    });
  }, [bilder]);

  // Marker als GeoJSON-Layer rendern + Clustering. Ersetzt das frühere DOM-Marker-Rendering.
  // ALS LETZTER Daten-Effekt registriert (nach dem Bild-Effekt) → der Marker-render-Poller läuft
  // zuletzt, die Marker-Layer liegen über Abschnitten/Zonen/Bildern; zusätzlich pinnt
  // sorgeFuerMarkerLayer sie per moveLayer nach oben.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const marker = baueMarkerFc(markers);
    const einsatzort = baueEinsatzortFc(markers);
    markerDatenRef.current = marker;
    einsatzortDatenRef.current = einsatzort;
    // Registry für styleimagemissing füllen (Key → TzProps). tzIconKey ist die EINE Quelle der
    // Key-Bildung (identisch zum icon-Property aus baueMarkerFc) → DRY.
    const registry = new Map<string, TzProps>();
    for (const mk of markers) {
      if (mk.tz) registry.set(tzIconKey(mk.tz), mk.tz);
    }
    tzRegistryRef.current = registry;
    wendeKartenDatenAn(map, () => reAnlegenMarker(map, markerDatenRef.current, einsatzortDatenRef.current));
  }, [markers]);

  // Marker-/Cluster-Klick + Cursor. Marker-Klick → Inspector (schluessel); Cluster-Klick → reinzoomen.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const klickMarker = (e: maplibregl.MapLayerMouseEvent) => {
      const schluessel = e.features?.[0]?.properties?.schluessel;
      if (typeof schluessel === 'string') onMarkerKlick?.(schluessel);
    };
    const klickCluster = (e: maplibregl.MapLayerMouseEvent) => {
      const f = e.features?.[0];
      const clusterId = f?.properties?.cluster_id;
      if (clusterId == null) return;
      const src = map.getSource(MARKER_CLUSTER_QUELLE) as GeoJSONSource | undefined;
      if (!src) return;
      src.getClusterExpansionZoom(clusterId as number).then((zoom) => {
        const coords = (f!.geometry as GeoJSON.Point).coordinates as [number, number];
        map.easeTo({ center: coords, zoom });
      }).catch(() => { /* Cluster nach Daten-Update verschwunden → ignorieren */ });
    };
    const enter = () => { map.getCanvas().style.cursor = 'pointer'; };
    const leave = () => { map.getCanvas().style.cursor = ''; };
    for (const id of MARKER_KLICK_LAYER) {
      map.on('click', id, klickMarker);
      map.on('mouseenter', id, enter);
      map.on('mouseleave', id, leave);
    }
    map.on('click', CLUSTER_LAYER, klickCluster);
    map.on('mouseenter', CLUSTER_LAYER, enter);
    map.on('mouseleave', CLUSTER_LAYER, leave);
    return () => {
      for (const id of MARKER_KLICK_LAYER) {
        map.off('click', id, klickMarker);
        map.off('mouseenter', id, enter);
        map.off('mouseleave', id, leave);
      }
      map.off('click', CLUSTER_LAYER, klickCluster);
      map.off('mouseenter', CLUSTER_LAYER, enter);
      map.off('mouseleave', CLUSTER_LAYER, leave);
    };
  }, [onMarkerKlick]);

  // Viewport nach Kartenbewegung melden: Zoom (für „näher heranzoomen"-Hinweise) immer,
  // bbox (für bbox-abhängige Ebenen wie KRITIS) nur ab KRITIS_MIN_ZOOM — verhindert riesige
  // Overpass-Anfragen. Sendet sofort beim Wirksamwerden und dann nach jedem moveend (600ms-Debounce).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || (!onBboxAenderung && !onZoomAenderung)) return;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const verarbeite = () => {
      const zoom = map.getZoom();
      onZoomAenderung?.(zoom);
      if (onBboxAenderung && zoom >= KRITIS_MIN_ZOOM) {
        const b = map.getBounds();
        onBboxAenderung(`${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}`);
      }
    };

    const melde = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(verarbeite, 600);
    };

    verarbeite(); // initial (z. B. wenn KRITIS aktiviert wird während Karte bereits passend gezoomt ist)
    map.on('moveend', melde);
    return () => {
      if (timer) clearTimeout(timer);
      map.off('moveend', melde);
    };
  }, [onBboxAenderung, onZoomAenderung]);

  // Klick auf ein Fachebenen-Objekt → meldet Properties + Quelle nach oben (Detail-Panel).
  // Handler je aktivem anklickbaren Layer (Closure über die Quelle); Cursor wird zur Hand.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const binds = (fachebenen ?? []).map((fe) => {
      const id = fachebeneClickLayerId(fe.def);
      const quelle = fe.def.key;
      const klick = (e: maplibregl.MapLayerMouseEvent) => {
        const props = (e.features?.[0]?.properties ?? {}) as Record<string, unknown>;
        onFachebeneKlick?.(props, quelle);
      };
      const enter = () => { map.getCanvas().style.cursor = 'pointer'; };
      const leave = () => { map.getCanvas().style.cursor = ''; };
      map.on('click', id, klick);
      map.on('mouseenter', id, enter);
      map.on('mouseleave', id, leave);
      return { id, klick, enter, leave };
    });
    return () => {
      for (const b of binds) {
        map.off('click', b.id, b.klick);
        map.off('mouseenter', b.id, b.enter);
        map.off('mouseleave', b.id, b.leave);
      }
    };
  }, [fachebenen, onFachebeneKlick]);

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

  // Stabile Ref für onPlatzierGeometrie (Callback-Identität soll den Effekt nicht neu auslösen).
  const onPlatzierGeometrieRef = useRef(onPlatzierGeometrie);
  onPlatzierGeometrieRef.current = onPlatzierGeometrie;

  // Bild-Manipulationsgriffe (Ecken/Drehen/Verschieben) im Platzier-Modus.
  const handlesRef = useRef<BildHandles | null>(null);

  // Griffe erzeugen/zerstören — NUR an der Bild-ID hängen, damit ecken-Änderungen
  // (numerische Eingabe / Refetch nach Commit) die Griffe nicht zerstören/neu erzeugen
  // (würde eine laufende Ziehgeste unterbrechen). Live-Vorschau + PATCH erst bei dragend
  // kapselt bildHandles selbst.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !platzierBild) {
      handlesRef.current?.zerstoeren();
      handlesRef.current = null;
      return;
    }
    const handles = erzeugeBildHandles(map, platzierBild.id, platzierBild.ecken, (ecken) => {
      onPlatzierGeometrieRef.current?.(ecken);
    });
    handlesRef.current = handles;
    return () => {
      handles.zerstoeren();
      handlesRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platzierBild?.id]);

  // Externe Ecken-Änderungen (numerische Mittelpunkt-Eingabe / Refetch nach Commit) an die
  // Griffe spiegeln. Läuft nicht mid-drag (der drag setzt die Geometrie selbst kontinuierlich).
  useEffect(() => {
    if (platzierBild) handlesRef.current?.setzeEcken(platzierBild.ecken);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platzierBild?.ecken]);

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} data-testid="kartenflaeche" />;
});

export default Kartenflaeche;
