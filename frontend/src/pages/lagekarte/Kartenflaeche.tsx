import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import maplibregl, { type LngLatLike, type StyleSpecification, type GeoJSONSource } from 'maplibre-gl';
import { Protocol } from 'pmtiles';
import { erzeugeTaktischesZeichen } from 'taktische-zeichen-react';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { KarteMarker } from './marker';
import {
  baueMarkerFc, baueEinsatzortFc, reAnlegenMarker, pinneMarkerLayerNachOben,
  MARKER_CLUSTER_QUELLE, MARKER_KLICK_LAYER, SPIDER_KLICK_LAYER, setzeSpiderDaten,
  type MarkerFeatureCollection, type MarkerProps,
} from './markerLayer';
import { baueSpiderFc, SPIDER_CAP, type SpiderProjektor } from './spiderfy';
import { tzIconKey } from './markerIcons';
import { baueClusterDonut } from './clusterDonut';
import type { TzProps } from './taktischesZeichen';
import type { GeoJsonPolygon, GeoJsonGeometry } from './geo';
import { createZeichnung, type Zeichnung, type ZeichenModus } from './zeichnen';
import { wendeKartenDatenAn } from './kartenDaten';
import { absolutiereProxyAnfrage } from './basemapStil';
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
  // Cluster-DOM-Donut-Marker (cluster_id → Marker). clusterDomRef = alle bekannten,
  // clusterDomOnScreenRef = aktuell auf der Karte (Mapbox-Donut-Sync-Muster).
  const clusterDomRef = useRef<Record<string, maplibregl.Marker>>({});
  const clusterDomOnScreenRef = useRef<Record<string, maplibregl.Marker>>({});
  // Offener Spider: cluster_id (String) oder null. spiderTokenRef entwertet in-flight getClusterLeaves
  // (Race-Guard: schneller A→B-Wechsel darf nicht A's Leaves über B malen).
  const spiderOffenRef = useRef<string | null>(null);
  const spiderTokenRef = useRef(0);
  // Controller-Funktionen als Refs, damit der DOM-Donut-Klickhandler + die Daten-/Style-Effekte sie
  // aufrufen können, ohne als Dependency neu zu binden.
  const oeffneSpiderRef = useRef<(clusterId: string, center: [number, number], anzahl: number) => void>(() => {});
  const schliesseSpiderRef = useRef<() => void>(() => {});
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
      // Server-Proxy-URLs (/api/karte/proxy/…, LFH-182) sind root-relativ; im Tile-Worker ohne
      // Dokument-Base scheitern sie sonst. Hier gegen die Origin absolutieren.
      transformRequest: absolutiereProxyAnfrage,
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
      // erzeugeTaktischesZeichen kann bei nicht-DV-102-konformen tz-Werten (organisation/fachaufgabe
      // werden in baueTzProps ungeprüft gecastet) synchron werfen. ZUERST erzeugen, ERST DANACH zu
      // ladendeIcons hinzufügen — sonst bliebe die id bei einem Throw dauerhaft im Guard hängen
      // (Icon nie wieder ladbar) und der Fehler flöge ungefangen aus dem MapLibre-Callback.
      let bild;
      try {
        bild = erzeugeTaktischesZeichen(tz);
      } catch {
        return;
      }
      ladendeIcons.add(id);
      const { dataUrl, size } = bild;
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
    schliesseSpiderRef.current?.(); // setStyle wischt Spider-Sources/Layer → Controller-State sonst stale
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
      // Fachebenen-Layer werden ohne beforeId angelegt (landen oben) → Marker erneut nach oben
      // pinnen, sonst verdecken frisch aktivierte Fachebenen die Marker und fangen ihre Klicks ab.
      pinneMarkerLayerNachOben(map);
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
    // Cluster-Zusammensetzung kann sich geändert haben → DOM-Donuts verwerfen; der render-Sync baut
    // sie mit frischen Typ-Counts neu auf (ein wiederverwendeter cluster_id zeigte sonst stale Segmente).
    for (const id in clusterDomOnScreenRef.current) clusterDomOnScreenRef.current[id].remove();
    clusterDomOnScreenRef.current = {};
    clusterDomRef.current = {};
    // Offener Spider hielte einen veralteten getClusterLeaves-Snapshot (cluster_ids ändern sich) →
    // bei jeder Daten-Änderung (SSE/Query-Invalidation) einklappen.
    schliesseSpiderRef.current?.();
  }, [markers]);

  // Einzel-Marker-Klick → Inspector (schluessel) + Cursor. Cluster-Klick läuft über die
  // DOM-Donut-Marker (eigener Effekt unten).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const klickMarker = (e: maplibregl.MapLayerMouseEvent) => {
      const schluessel = e.features?.[0]?.properties?.schluessel;
      if (typeof schluessel === 'string') onMarkerKlick?.(schluessel);
    };
    const enter = () => { map.getCanvas().style.cursor = 'pointer'; };
    const leave = () => { map.getCanvas().style.cursor = ''; };
    // Aufgefächerte Spider-Leaves verhalten sich wie Einzelmarker (Klick → onMarkerKlick, Cursor).
    const klickLayer = [...MARKER_KLICK_LAYER, ...SPIDER_KLICK_LAYER];
    for (const id of klickLayer) {
      map.on('click', id, klickMarker);
      map.on('mouseenter', id, enter);
      map.on('mouseleave', id, leave);
    }
    return () => {
      for (const id of klickLayer) {
        map.off('click', id, klickMarker);
        map.off('mouseenter', id, enter);
        map.off('mouseleave', id, leave);
      }
    };
  }, [onMarkerKlick]);

  // Cluster als DOM-Donut-Marker (Mapbox-Donut-Muster): bei jedem render die sichtbaren Cluster aus
  // der Source lesen und HTML-Donut-Marker erzeugen/wiederverwenden/entfernen. Der Donut zeigt die
  // Typ-Zusammensetzung + Gesamtzahl mit weichem Schatten (was ein WebGL-circle nicht kann); Klick
  // zoomt auf den Auflösungs-Zoom. Einzelmarker bleiben die GeoJSON-Symbol/Circle-Layer.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const aktualisiere = () => {
      if (!map.isSourceLoaded(MARKER_CLUSTER_QUELLE)) return;
      const neu: Record<string, maplibregl.Marker> = {};
      for (const f of map.querySourceFeatures(MARKER_CLUSTER_QUELLE)) {
        const props = f.properties as Record<string, unknown>;
        if (!props.cluster) continue;
        const id = String(props.cluster_id);
        if (neu[id]) continue; // querySourceFeatures kann denselben Cluster über mehrere Tiles liefern
        let marker = clusterDomRef.current[id];
        if (!marker) {
          const coords = (f.geometry as GeoJSON.Point).coordinates as [number, number];
          const el = baueClusterDonut(props);
          el.addEventListener('click', (ev) => {
            ev.stopPropagation();
            // Donut-Klick fächert auf (statt reinzuzoomen); der Controller toggelt/fällt bei
            // Großclustern auf Reinzoomen zurück. stopPropagation → erreicht den allgemeinen
            // map-click NICHT (Re-Klick läuft über oeffne, nicht über das Leer-Klick-Einklappen).
            oeffneSpiderRef.current?.(id, coords, Number(props.point_count ?? 0));
          });
          marker = new maplibregl.Marker({ element: el }).setLngLat(coords);
          clusterDomRef.current[id] = marker;
        }
        neu[id] = marker;
        if (!clusterDomOnScreenRef.current[id]) marker.addTo(map);
      }
      for (const id in clusterDomOnScreenRef.current) {
        if (!neu[id]) { clusterDomOnScreenRef.current[id].remove(); delete clusterDomRef.current[id]; }
      }
      clusterDomOnScreenRef.current = neu;
    };
    map.on('render', aktualisiere);
    return () => {
      map.off('render', aktualisiere);
      for (const id in clusterDomOnScreenRef.current) clusterDomOnScreenRef.current[id].remove();
      clusterDomOnScreenRef.current = {};
      clusterDomRef.current = {};
    };
  }, []);

  // Spider-Controller: Cluster-Donut-Klick fächert die Leaves auf (statt reinzuzoomen) und klappt
  // zuverlässig wieder ein. WebGL-Laufzeit → lebt hier (einzige MapLibre-Stelle). Setup-once ([]),
  // Map über Ref. Einklapp-Trigger: Karten-Move/Zoom, leerer Klick, ESC, erneuter/anderer
  // Cluster-Klick (Toggle/A→B via oeffne); Live-Daten-Änderung ([markers]-Effekt) und Style-Wechsel
  // ([style]-Effekt) rufen schliesse() über schliesseSpiderRef.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const leer = { type: 'FeatureCollection' as const, features: [] };

    const schliesse = () => {
      spiderTokenRef.current++;            // in-flight getClusterLeaves entwerten (load-bearing)
      if (spiderOffenRef.current === null) return;
      spiderOffenRef.current = null;
      // mapRef wird im Map-Cleanup ZUERST genullt (Effekt-Reihenfolge) → beim Unmount mit offenem
      // Spider ist die Map schon entfernt; getSource würfe sonst (kein internes Guard). Token-Bump
      // läuft trotzdem, damit kein in-flight-Lauf nach dem Unmount noch malt.
      if (mapRef.current) setzeSpiderDaten(map, leer, leer);
    };

    const oeffne = (clusterId: string, center: [number, number], anzahl: number) => {
      if (spiderOffenRef.current === clusterId) { schliesse(); return; } // Toggle / erneuter Klick
      schliesse();                                                        // A→B: A einklappen
      const src = map.getSource(MARKER_CLUSTER_QUELLE) as GeoJSONSource | undefined;
      if (!src) return;
      // Großcluster → Fallback: reinzoomen (verkleinert Cluster, dann erneut auffächerbar).
      if (anzahl > SPIDER_CAP) {
        src.getClusterExpansionZoom(Number(clusterId))
          .then((zoom) => map.easeTo({ center, zoom }))
          .catch(() => { /* Cluster nach Daten-Update weg → ignorieren */ });
        return;
      }
      const token = ++spiderTokenRef.current;
      src.getClusterLeaves(Number(clusterId), SPIDER_CAP, 0)
        .then((leaves) => {
          if (token !== spiderTokenRef.current) return; // stale (anderer Cluster geklickt / eingeklappt)
          const projektor: SpiderProjektor = {
            project: (ll) => map.project(ll),
            unproject: (px) => map.unproject([px.x, px.y]),
          };
          const props = leaves.map((f) => f.properties as MarkerProps);
          const { leaves: leafFc, legs } = baueSpiderFc(props, center, projektor);
          setzeSpiderDaten(map, leafFc, legs);
          spiderOffenRef.current = clusterId;
        })
        .catch(() => { /* Cluster nach Daten-Update weg → ignorieren */ });
    };

    oeffneSpiderRef.current = oeffne;
    schliesseSpiderRef.current = schliesse;

    const aufKey = (e: KeyboardEvent) => { if (e.key === 'Escape') schliesse(); };
    map.on('movestart', schliesse);  // jede Karten-Bewegung/Zoom klappt ein
    map.on('click', schliesse);      // leerer Klick (und nach Leaf-Routing) klappt ein
    window.addEventListener('keydown', aufKey);
    return () => {
      map.off('movestart', schliesse);
      map.off('click', schliesse);
      window.removeEventListener('keydown', aufKey);
      schliesse();
    };
  }, []);

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
