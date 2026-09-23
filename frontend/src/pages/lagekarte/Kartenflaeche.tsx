import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
// Namespace-Import, weil maplibre-gl ab 6 echtes ESM ohne Default-Export ist (v5 lieferte ein
// UMD-Bundle, aus dem Bundler/TS per CJS-Interop einen Default synthetisierten). Bewusst KEIN
// named-Import der Klassen: `Map` würde den globalen `Map` beschatten, den die tzRegistry unten
// als `useRef<Map<string, TzProps>>` nutzt — der Fehler landete dann auf der Registry-Zeile und
// zeigte von der Ursache weg. `import * as ns, { type X }` ist kein gültiges ES, daher zwei Zeilen.
import * as maplibregl from 'maplibre-gl';
import type { LngLatLike, StyleSpecification, GeoJSONSource } from 'maplibre-gl';
// Der Worker MUSS explizit verdrahtet werden, und zwar mit `?worker&url`, nicht `?url`:
// maplibre 6 baut seine Worker-URL zur Laufzeit aus `import.meta.url` in einer Variablen zusammen
// (`web_worker.ts`), was kein Bundler statisch sieht — ohne das hier emittiert `vite build` die
// Worker-Datei gar nicht erst, mit exit 0 und ohne Warnung. Zur Laufzeit lädt dann der Style, aber
// es kommt keine einzige Kachel. `?url` allein ist die Falle daneben: es emittiert zwar eine Datei,
// die aber weiter ihre Geschwisterdatei `maplibre-gl-shared.mjs` importiert und daran stirbt.
// `?worker&url` bündelt self-contained — und nur diese Variante landet als `.js` im
// Workbox-Precache-Manifest, ist also auch offline da.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { erzeugeTaktischesZeichen } from 'taktische-zeichen-react';
import 'maplibre-gl/dist/maplibre-gl.css';

import type { KarteMarker } from './marker';
import {
  baueMarkerFc,
  baueEinsatzortFc,
  reAnlegenMarker,
  pinneMarkerLayerNachOben,
  CLUSTER_QUELLEN,
  clusterSchluessel,
  MARKER_CLUSTER_QUELLE,
  MARKER_KLICK_LAYER,
  PERSONEN_CLUSTER_KLICK_LAYER,
  PERSONEN_CLUSTER_QUELLE,
  personenClusterTreffer,
  naechstesMerkmal,
  SPIDER_KLICK_LAYER,
  setzeSpiderDaten,
  type MarkerFeatureCollection,
  type MarkerProps,
} from './markerLayer';
import { baueSpiderFc, SPIDER_CAP, type SpiderProjektor } from './spiderfy';
import { tzIconKey } from './markerIcons';
import { baueClusterDonut, setzeHuelleDurchlaessig } from './clusterDonut';
import type { TzProps } from './taktischesZeichen';
import type { GeoJsonPolygon, GeoJsonGeometry } from './geo';
import { werteFachebenenKlickAus } from './geo';
import { createZeichnung, type Zeichnung, type ZeichenModus } from './zeichnen';
import { createMessung, type MessZeichnung } from './messZeichnung';
import type { MessForm, MessGeometrie } from './messung';
import { wendeKartenDatenAn } from './kartenDaten';
import { absolutiereProxyAnfrage } from './basemapStil';
import { neuerStilFehlerWaechter } from './stilFehlerWaechter';
import {
  baueFlaechenFc,
  baueZonenFc,
  planeReAnlegenNachStyle,
  sorgeFuerAbschnittLayer,
  sorgeFuerZonenLayer,
  plakettenBild,
  PLAKETTE_PRAEFIX,
  type FlaechenFeatureCollection,
  type ZonenFeatureCollection,
  type ZoneFeature,
  type AktiveFachebene,
} from './kartenLayer';
import {
  sorgeFuerFachebeneLayer,
  setzeFachebeneDaten,
  entferneFachebeneLayer,
  fachebeneClickLayerIds,
  fachebeneSourceId,
  entscheideFachebeneKlick,
  type FachebeneKlickZiel,
} from './fachebenenLayer';
import { synchronisiereBildLayer, entferneBildLayer, type BildOverlay } from './bildLayer';
import { eckenInitialPixel, type Punkt } from './bildGeometrie';
import { erzeugeBildHandles, type BildHandles } from './bildHandles';
import type { Ecken } from '../../api/kartenbilder';
import { BBOX_MIN_ZOOM } from './fachebenen';
import type { FachebeneQuelle } from '../../api/fachebenen';
import { PUNKT_ZOOM, type StartAnsicht } from './startAnsicht';
import { zonenPlakette } from './plakette';
import { useRollen } from '../../components/instrument/rollenwerte';

// Worker-URL setzen, bevor die erste Map entsteht — diese Datei ist die einzige Stelle im Repo,
// die eine Map erzeugt. Der Guard davor ist keine Paranoia, sondern deckt eine gemessene Bruchlinie
// ab: maplibre nimmt die URL intern als `config.WORKER_URL || defaultWorkerUrl()` — ein `||`, kein
// `??`. Käme hier je ein falsy Wert an (Vite-Versionswechsel, jemand streicht das `&url`, anderer
// Build-Modus), fiele maplibre STILL auf seinen Default zurück. Und der ist die perfide Variante:
// unter Dev löst er auf eine echte, von Vite ausgelieferte Datei auf und alles bleibt grün — im
// Prod-Build zeigt er auf `/assets/maplibre-gl-worker.mjs`, das es dort nicht gibt, und die Karte
// lädt keine einzige Kachel. Dev grün, Prod tot, ohne eine Fehlermeldung. Lieber hier laut brechen.
if (!workerUrl)
  throw new Error('maplibre-Worker-URL ist leer — `?worker&url` hat nichts geliefert');
maplibregl.setWorkerUrl(workerUrl);

/** Ein Aufruf von `transformRequest`: was MapLibre wollte (`ein`) und was es bekam (`aus`). */
interface KartenAnfrage {
  ein: string;
  aus: string;
}
/** Obergrenze des DEV-Mitschnitts. Eine offene Karte holt Kacheln im Sekundentakt; ohne Deckel
 *  wüchse die Liste über eine Dev-Sitzung unbegrenzt. 40 reicht für jede Zusicherung — die
 *  ersten Einträge sind Style/Glyphs/Kacheln des ersten Laufs, und genau die werden geprüft. */
const ANFRAGEN_DECKEL = 40;

/**
 * `transformRequest` der Karte — plus DEV-Mitschnitt unter `window.__lfhKartenAnfragen`.
 *
 * WARUM DER MITSCHNITT SEIN MUSS (LFH-356, gemessen): die Absolutierung ist vom Netz aus
 * NICHT beobachtbar. Der Versuch, sie über die tatsächlich abgesetzte Kachel-URL zu belegen,
 * scheitert — mit ENTFERNTEM `transformRequest` lud der Kachel-Fixture-Lauf unverändert
 * durch: 4 Kachel-Anfragen, alle absolut, `map.loaded()` true. Grund: maplibre 6 fetcht im
 * Worker über `new Request(url)`, und der löst eine root-relative URL gegen
 * `self.location` des WORKER-SKRIPTS auf — das liegt bei uns same-origin
 * (`setWorkerUrl` oben), also kommt dasselbe heraus. Ein Test auf die Netz-Wirkung wäre
 * grün, ohne dass diese Zeile je liefe: er könnte nicht rot werden.
 *
 * Die Absolutierung bleibt trotzdem tragend, und zwar nicht hypothetisch: ist die
 * Worker-URL cross-origin, baut maplibre den Worker aus einem **Blob**
 * (`maplibre-gl.mjs`: `if (!istCrossOrigin(url)) return new Worker(url)`, sonst
 * `createObjectURL`). In einem `blob:`-Worker hat `self.location` einen opaken Pfad, gegen
 * den sich `/api/karte/proxy/…` nicht auflösen lässt — genau das „Failed to parse URL" aus
 * LFH-182. Wer Assets je auf ein CDN legt, fällt ohne diese Zeile sofort hinein.
 *
 * Der Mitschnitt ist damit die einzige Stelle, an der „läuft der Seam?" widerlegbar ist —
 * dieselbe Begründung wie beim Karten-Handle `__lfhKarte` weiter unten, und wie dort ist
 * die Zeile im Prod-Build weg (`import.meta.env.DEV` ist dann die Konstante `false`, der
 * Zweig fällt beim Bündeln heraus).
 */
function transformiereKartenAnfrage(url: string): { url: string } {
  const ergebnis = absolutiereProxyAnfrage(url);
  if (import.meta.env.DEV) {
    const w = window as unknown as { __lfhKartenAnfragen?: KartenAnfrage[] };
    const liste = (w.__lfhKartenAnfragen ??= []);
    if (liste.length < ANFRAGEN_DECKEL) liste.push({ ein: url, aus: ergebnis.url });
  }
  return ergebnis;
}

// Re-Export: LagekartePage importiert ZoneFeature weiterhin aus Kartenflaeche.
export type { ZoneFeature };

export interface KartenflaecheProps {
  style: StyleSpecification | string;
  markers: KarteMarker[];
  /** Karten-Klick (z. B. zum Platzieren) — liefert geklickte Koordinate. */
  onKarteKlick?: (lngLat: { lng: number; lat: number }) => void;
  /** Marker-Klick → Inspector öffnen. */
  onMarkerKlick?: (schluessel: string) => void;
  /** Beim Setzen sanft hinfliegen. */
  flyToZiel?: { lng: number; lat: number } | null;
  /**
   * Startansicht aus den Einsatzdaten (`startAnsicht.ts`). `undefined` heißt „noch nicht
   * entschieden" (Daten laden), `null` „nichts verortet, Übersicht behalten". Sie greift
   * GENAU EINMAL je Karte: danach gehört der Ausschnitt der Bedienung — ein Live-Update, das
   * einen neuen Marker bringt, darf den Ausschnitt nicht wegziehen. Ein früherer `flyToZiel`
   * (Deeplink) verbraucht sie ebenfalls.
   */
  startAnsicht?: StartAnsicht | null;
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
  /** Monoton steigend bei jedem Zonen-Zeichnen-Start; erzwingt ein Re-Fire des Effekts auch bei
   *  gleich bleibendem Modus (Zone→Zone mit gleichem Polygon-Modus), damit starten() einen
   *  offenen Entwurf verwirft. */
  zoneZeichnenNonce?: number;
  /** Callback nach abgeschlossenem Zeichnen einer Zone. */
  onZoneGezeichnet?: (geometrie: GeoJsonGeometry) => void;
  /** true, sobald im aktiven Abschnitts-/Zonen-Entwurf mindestens drei Punkte gesetzt sind. */
  onZeichnenBereitAenderung?: (bereit: boolean) => void;
  /** Klick auf eine Zone → Inspector. */
  onZoneKlick?: (id: number) => void;
  /** Messwerkzeug (LFH-616): aktive Form oder `null`. */
  messen?: MessForm | null;
  /** Laufender bzw. abgeschlossener Messentwurf; `null` = nichts gesetzt. */
  onMessung?: (geometrie: MessGeometrie | null, fertig: boolean) => void;
  /** Aktive Fachebenen mit Daten (externe Overlays). */
  fachebenen?: AktiveFachebene[];
  /** Bild-Hintergründe (Overlays über der Basemap, unter Abschnitten/Zonen/Markern). */
  bilder?: BildOverlay[];
  /** Karten-Viewport (west,sued,ost,nord) nach Bewegung — für bbox-abhängige Ebenen. */
  onBboxAenderung?: (bbox: string) => void;
  /** Aktueller Zoom nach Bewegung — für „näher heranzoomen"-Hinweise bbox-abhängiger Ebenen. */
  onZoomAenderung?: (zoom: number) => void;
  /** Klick auf ein Fachebenen-Objekt → liefert dessen Properties + Quelle + volle Geometrie
   *  (für Detail-Panel; Geometrie un-geclippt aus der geladenen FeatureCollection, LFH-146). */
  onFachebeneKlick?: (
    properties: Record<string, unknown>,
    quelle: FachebeneQuelle,
    geometrie?: { type: string; coordinates: unknown } | null,
  ) => void;
  /** Aktiv zu platzierendes Bild (null = kein Platzier-Modus). Zeigt Mittelpunkt-Drag-Handle. */
  platzierBild?: { id: number; ecken: Ecken } | null;
  /** Callback, wenn Platzier-Geometrie per Drag verändert wurde. */
  onPlatzierGeometrie?: (ecken: Ecken) => void;
  /** Zeigerlage über der Karte (Koordinatenanzeige); `null`, sobald er die Karte verlässt. */
  onZeigerLage?: (lage: { lat: number; lon: number } | null) => void;
  /**
   * Ziel-Element der Maßstabsleiste. MapLibres `ScaleControl` hängt sich sonst in seine
   * eigene Ecke (`.maplibregl-ctrl-bottom-left`) — absolut über der Karte, genau dort, wo
   * `KartenFuss` die Bänder im Fluss stapelt (LFH-355). Deshalb wird es über seine
   * öffentliche `IControl`-Schnittstelle (`onAdd`/`onRemove`) in ein Band des Fußes gehängt.
   */
  massstabZiel?: HTMLElement | null;
}

/** Imperative Karten-API für die Page: Upload-Platzierung + Auf-Bild-Zentrieren. */
export interface KartenHandle {
  /** Initiale Bild-Ecken für einen Upload: achsenparalleles Rechteck mittig im
   *  aktuellen Viewport, Breite ~50 % der kürzeren View-Kante, Seitenverhältnis = `ar`. */
  initialeEckenFuerBild(ar: number): Ecken | null;
  /** Karte auf die Bild-Ecken einpassen (fitBounds). */
  zentriereAufEcken(ecken: Ecken): void;
  /** Aktives Zonen-Zeichnen abschließen (native Finish-Geste). No-op, wenn nicht aktiv. */
  zoneAbschliessen(): boolean;
  /** Aktives Abschnitt-Zeichnen abschließen. No-op, wenn nicht aktiv. */
  abschnittAbschliessen(): boolean;
  /** Laufende Messung abschließen (LFH-616); false bei zu wenigen Punkten. */
  messungAbschliessen(): boolean;
  /** Messung verwerfen und in derselben Form neu beginnen. */
  neuMessen(): void;
  /** Eine Zoomstufe hinein/heraus — die Knöpfe der Überlagerung ersetzen `NavigationControl`. */
  zoomRein(): void;
  zoomRaus(): void;
  /** Drehung und Neigung zurücksetzen (Nordung) — der Kompass des alten `NavigationControl`. */
  nachNorden(): void;
}

const Kartenflaeche = forwardRef<KartenHandle, KartenflaecheProps>(function Kartenflaeche(
  {
    style,
    markers,
    onKarteKlick,
    onMarkerKlick,
    flyToZiel,
    onStyleFehler,
    attribution,
    flaechen,
    zeichnen,
    onFlaecheGezeichnet,
    onFlaecheKlick,
    zonen,
    zoneZeichnen,
    zoneZeichnenNonce,
    onZoneGezeichnet,
    onZoneKlick,
    messen,
    onMessung,
    onZeichnenBereitAenderung,
    fachebenen,
    onBboxAenderung,
    onZoomAenderung,
    onFachebeneKlick,
    bilder,
    platzierBild,
    onPlatzierGeometrie,
    onZeigerLage,
    massstabZiel,
    startAnsicht,
  },
  ref,
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  // Namensplaketten der Marker in den Rollen des aktiven Modus (LFH-622) — dieselbe
  // Plakette wie an den Zonen. `rollen` ist eine der zwei Paletten-Konstanten, also stabil.
  const { rollen } = useRollen();
  const markerPlakette = useMemo(() => zonenPlakette(rollen), [rollen]);
  // Aktuelle Marker-Daten als FeatureCollections; nach setStyle re-angelegt (analog flaechenDatenRef).
  const markerDatenRef = useRef<MarkerFeatureCollection>({
    type: 'FeatureCollection',
    features: [],
  });
  const einsatzortDatenRef = useRef<MarkerFeatureCollection>({
    type: 'FeatureCollection',
    features: [],
  });
  // Image-Key → TzProps; der styleimagemissing-Handler erzeugt daraus lazy die Karten-Icons.
  const tzRegistryRef = useRef<Map<string, TzProps>>(new Map());
  // Cluster-DOM-Donut-Marker (`clusterSchluessel` → Marker). clusterDomRef = alle bekannten,
  // clusterDomOnScreenRef = aktuell auf der Karte (Mapbox-Donut-Sync-Muster). Nur für
  // `marker-cluster`: Personen-Cluster (LFH-648) sind WebGL-Layer, damit sie UNTER den Kräften
  // liegen — ein DOM-Donut hinge über dem Canvas.
  const clusterDomRef = useRef<Record<string, maplibregl.Marker>>({});
  const clusterDomOnScreenRef = useRef<Record<string, maplibregl.Marker>>({});
  // Offener Spider: Cluster-Schlüssel (Quelle + cluster_id) oder null. spiderTokenRef entwertet in-flight getClusterLeaves
  // (Race-Guard: schneller A→B-Wechsel darf nicht A's Leaves über B malen).
  const spiderOffenRef = useRef<string | null>(null);
  const spiderTokenRef = useRef(0);
  // Controller-Funktionen als Refs, damit der DOM-Donut-Klickhandler + die Daten-/Style-Effekte sie
  // aufrufen können, ohne als Dependency neu zu binden.
  const oeffneSpiderRef = useRef<
    (
      quelle: (typeof CLUSTER_QUELLEN)[number],
      clusterId: number,
      center: [number, number],
      anzahl: number,
    ) => void
  >(() => {});
  const schliesseSpiderRef = useRef<() => void>(() => {});
  // Entscheidet, welches error-Event die Basemap abstuft (LFH-325): Kachel-Fehler nie,
  // höchstens eine Abstufung je angewandtem Style, nach dem Laden gar keine mehr.
  const stilWaechterRef = useRef(neuerStilFehlerWaechter());
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
  const onZeichnenBereitAenderungRef = useRef(onZeichnenBereitAenderung);
  onZeichnenBereitAenderungRef.current = onZeichnenBereitAenderung;
  // Dritter Controller: Messen (LFH-616). Eigene Instanz, weil er bei jeder Änderung meldet
  // statt erst beim Abschluss — Begründung in `messZeichnung.ts`.
  const messRef = useRef<MessZeichnung | null>(null);
  const onMessungRef = useRef(onMessung);
  onMessungRef.current = onMessung;
  const messenRef = useRef(messen);
  messenRef.current = messen;

  // Imperative API für die Page: Upload-Platzierung (Viewport-Mitte, Bild-Seitenverhältnis)
  // und Auf-Bild-Zentrieren. Pixel-Raum via project/unproject → exakt, ohne cos(lat)-Verzerrung.
  useImperativeHandle(
    ref,
    () => ({
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
      zoneAbschliessen() {
        return zoneDrawRef.current?.abschliessen() ?? false;
      },
      abschnittAbschliessen() {
        return drawRef.current?.abschliessen() ?? false;
      },
      messungAbschliessen() {
        return messRef.current?.abschliessen() ?? false;
      },
      neuMessen() {
        const form = messenRef.current;
        if (form) messRef.current?.starten(form);
      },
      zoomRein() {
        mapRef.current?.zoomIn();
      },
      zoomRaus() {
        mapRef.current?.zoomOut();
      },
      nachNorden() {
        mapRef.current?.resetNorthPitch();
      },
    }),
    [],
  );

  // Karte einmalig erzeugen.
  useEffect(() => {
    if (!containerRef.current) return;
    // Mitschnitt VOR dem Konstruktor leeren, nicht danach: `transformRequest` feuert bereits
    // für Style und Glyphs, während `new maplibregl.Map` läuft. Und leeren überhaupt, weil ein
    // Test sonst Einträge einer längst entfernten Karte läse — dieselbe Falle wie beim
    // Karten-Handle unten, nur ohne die Rettung, dass ein `delete` sie sichtbar macht.
    if (import.meta.env.DEV)
      (window as unknown as { __lfhKartenAnfragen?: KartenAnfrage[] }).__lfhKartenAnfragen = [];
    const map = new maplibregl.Map({
      container: containerRef.current,
      style,
      center: [10.45, 51.16], // Mitte DE als neutraler Start
      zoom: 5,
      attributionControl: false,
      // maplibre 6 hat hierfür den Default 4 eingeführt — eine Option, die wir nie gesetzt haben
      // und die das Rendering trotzdem ändert. Effektive Kachel-maxzoom wäre dann
      // max(source.maxzoom, maxZoom-4); unsere Offline-Weltübersicht hat maxzoom 6, es würden also
      // z7-18 aus EINEM z6-Tile client-seitig gesliced. Netzseitig harmlos (die echte Kachel-URL
      // wird weiter korrekt geholt), aber MapLibre dokumentiert selbst geänderte Label-Platzierung,
      // und auf Feldgeräten ist das Slicing auch eine CPU-/Speicherfrage. `undefined` stellt das
      // v5-Verhalten her — der Konstruktor merged per Spread, ein explizites undefined überschreibt
      // den Default also wirklich (nachgelesen in map.ts:723, `_zoomLevelsToOverscale` ist
      // `number | undefined`). Bewusste Entscheidung, kein Versehen: wer Overscaling will, setzt
      // hier eine Zahl und prüft die Basemap-Beschriftung auf einem echten Gerät nach.
      zoomLevelsToOverscale: undefined,
      // Server-Proxy-URLs (/api/karte/proxy/…, LFH-182) sind root-relativ; in einem
      // Blob-Tile-Worker ohne auflösbare Base scheitern sie. Hier gegen die Origin
      // absolutieren — Begründung und DEV-Mitschnitt oben an `transformiereKartenAnfrage`.
      transformRequest: transformiereKartenAnfrage,
    });
    // KEIN `NavigationControl` mehr (Neuentwurf S5): Zoom, Nordung und Zeichnen stehen im
    // Knopfblock der Überlagerung (`KartenUeberlagerung.tsx`) und rufen den Handle oben.
    // Fenster für die Basemap-Abstufung schließen, sobald der STYLE steht — NICHT erst bei
    // 'load'. 'load' wartet auf das Absetzen aller sichtbaren Kacheln (Map.loaded →
    // Style.loaded → TileManager.loaded), sein Fenster umfasst also den kompletten ersten
    // Kachel-Lauf. 'style.load' feuert dagegen in Style._load, also erst nachdem das
    // Style-JSON geladen und angewandt wurde — und bei einem gescheiterten Style-Fetch gar
    // nicht (dort feuert stattdessen ein ErrorEvent). Genau die richtige Trennlinie (LFH-325).
    map.on('style.load', () => {
      stilWaechterRef.current.stilGeladen();
    });
    map.on('load', () => {
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
      // Beschriftungsplakette der Zonen und Marker (9-Slice, Farben stehen in der Id). Nach `setStyle`
      // sind alle Bilder weg; dieser Handler legt sie beim nächsten Bedarf wieder an.
      if (id.startsWith(PLAKETTE_PRAEFIX)) {
        const bild = plakettenBild(id);
        if (!bild || map.hasImage(id)) return;
        const { width, height, data, ...dehnung } = bild;
        map.addImage(id, { width, height, data }, dehnung);
        return;
      }
      if (!id.startsWith('tz|')) return; // fremde IDs ignorieren
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
      img.onerror = () => {
        ladendeIcons.delete(id);
      };
      img.src = dataUrl;
    });
    mapRef.current = map;
    // Testhaken für den Browser-Smoke (e2e/lagekarte-smoke.spec.ts): die Karte lebt in WebGL, ihr
    // Zustand ist im DOM praktisch unsichtbar — ein toter Tile-Worker lässt Canvas, Controls und
    // Cursor unverändert stehen (gemessen), nur `map.loaded()` kippt. Ohne einen Griff auf die
    // Instanz gäbe es keine Assertion, die das fängt. `import.meta.env.DEV` heißt: im Prod-Build
    // ist die Zeile weg, e2e läuft unter Vite-Dev also mit Haken, Auslieferung ohne.
    // Bewusst statt der früher genutzten React-Fiber-Traversierung: die hängt an React-Internas
    // und reißt beim nächsten React-Sprung — als Kartenfehler getarnt.
    if (import.meta.env.DEV) (window as unknown as { __lfhKarte?: unknown }).__lfhKarte = map;
    return () => {
      map.remove(); // zerstört auch die AttributionControl
      mapRef.current = null;
      // Testhaken mit abräumen: sonst zeigt er nach dem Verlassen der Seite auf eine ENTFERNTE
      // Map. Ein späterer Test läse dann Zustand von einer toten Instanz und wäre grün, ohne dass
      // je eine Karte lief — genau die Sorte stiller Fehlbeleg, gegen die der Haken existiert.
      // (Unter StrictMode ist die Reihenfolge Effekt A → Cleanup A → Effekt B, der Haken zeigt
      // danach also korrekt auf die zweite, lebende Instanz.)
      if (import.meta.env.DEV) {
        delete (window as unknown as { __lfhKarte?: unknown }).__lfhKarte;
        // Mitschnitt mit abräumen, aus demselben Grund: eine stehengebliebene Liste stammte
        // von der entfernten Karte, und ein Test darauf wäre grün, ohne dass eine Karte lief.
        delete (window as unknown as { __lfhKartenAnfragen?: unknown }).__lfhKartenAnfragen;
      }
      // Ref nullen: sonst sieht der Attribution-Effekt nach StrictMode-Remount eine
      // stale Control der entfernten Map und ruft removeControl auf bereits Zerstörtem.
      attribControlRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Style wechseln (Basemap-Umschalter / Theme). Bewusst KEIN Zurücksetzen des
  // Geladen-Zustands: ein Style-Ladefehler nach manuellem Wechsel wird NICHT über
  // onStyleFehler gemeldet (das würde transiente Tile-Errors als Fehler werten).
  // `stilAngewandt()` schärft nur die EINE Abstufung je Style neu — damit bleibt die
  // Degradationskette online→offline→blind bei echter Nicht-Erreichbarkeit erhalten,
  // ohne dass zwei Fehler im selben Ladefenster zwei Stufen springen (LFH-325).
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
    stilWaechterRef.current.stilAngewandt();
    // Eine laufende Messung überlebt `setStyle` nicht: `diff: false` wirft die Sources des
    // terra-draw-Adapters mit weg, und der legt sie nicht neu an — die nächste Zeigerbewegung
    // (`setData`) und spätestens das Beenden (`removeSource`) würfen (Review LFH-616). Die
    // Messung wird deshalb VOR dem Wechsel geräumt und danach in derselben Form neu begonnen;
    // der Messwert ist ein Blick, kein Entwurf, sein Verlust beim Kartenwechsel ist hinnehmbar.
    const messForm = messenRef.current;
    if (messForm) messRef.current?.stoppen();
    map.setStyle(style, { diff: false });
    if (messForm) {
      map.once('style.load', () => {
        const noch = messenRef.current;
        if (noch && messRef.current) messRef.current.starten(noch);
      });
    }
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
    const handler = (e: maplibregl.MapMouseEvent) =>
      onKarteKlick?.({ lng: e.lngLat.lng, lat: e.lngLat.lat });
    map.on('click', handler);
    // Nur der INITIALE Style-Ladefehler stuft die Basemap ab. MapLibre feuert 'error' auch
    // für einzelne fehlende Tiles — und zwar ZWANGSLÄUFIG vor 'load', weil 'load' selbst auf
    // das Absetzen aller sichtbaren Kacheln wartet (siehe stilFehlerWaechter.ts). Die
    // Klassifikation liegt deshalb im Wächter; hier wird nur verdrahtet und laut protokolliert,
    // damit eine Abstufung im Feld nachvollziehbar ist statt still die Karte zu leeren.
    const fehler = (e: unknown) => {
      if (!stilWaechterRef.current.meldeFehler(e as { tile?: unknown })) return;
      console.warn('[Lagekarte] Basemap-Style nicht ladbar → Abstufung der Anzeige', e);
      onStyleFehler?.();
    };
    map.on('error', fehler);
    return () => {
      map.off('click', handler);
      map.off('error', fehler);
    };
  }, [onKarteKlick, onStyleFehler]);

  // Zeigerlage melden (Koordinatenanzeige der Überlagerung). Über eine Ref, damit eine neue
  // Callback-Identität die Handler nicht bei jedem Render ab- und anmeldet.
  const onZeigerLageRef = useRef(onZeigerLage);
  onZeigerLageRef.current = onZeigerLage;
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const bewegt = (e: maplibregl.MapMouseEvent) =>
      onZeigerLageRef.current?.({ lat: e.lngLat.lat, lon: e.lngLat.lng });
    const verlassen = () => onZeigerLageRef.current?.(null);
    map.on('mousemove', bewegt);
    map.on('mouseout', verlassen);
    return () => {
      map.off('mousemove', bewegt);
      map.off('mouseout', verlassen);
    };
  }, []);

  // Maßstabsleiste (metrisch) in das Band des Kartenfußes hängen — siehe `massstabZiel`.
  // `onAdd` legt das Element im Kartencontainer an und abonniert `move`; `appendChild`
  // VERSCHIEBT es in das Band. `onRemove` räumt Element und Abo wieder ab.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !massstabZiel) return;
    const massstab = new maplibregl.ScaleControl({ maxWidth: 88, unit: 'metric' });
    massstabZiel.appendChild(massstab.onAdd(map));
    return () => {
      massstab.onRemove();
    };
  }, [massstabZiel]);

  // Startansicht einmalig anwenden. Steht VOR dem fly-to-Effekt: kommen beide in derselben
  // Runde (Deeplink `?gefahrengebiet=`), läuft das fly-to danach und gewinnt.
  // „Verbraucht" hängt an der KARTENINSTANZ, nicht an einem Boolean: unter StrictMode (Vite-
  // Dev, e2e) läuft der Erzeugungs-Effekt zweimal, die erste Karte wird entfernt — ein
  // Boolean-Ref überlebte das und ließe die zweite, sichtbare Karte auf der Übersicht stehen
  // (so im Browser gemessen).
  const startAufKarteRef = useRef<maplibregl.Map | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || startAnsicht === undefined || startAufKarteRef.current === map) return;
    startAufKarteRef.current = map;
    if (startAnsicht === null) return;
    if (startAnsicht.art === 'punkt') {
      map.jumpTo({ center: [startAnsicht.lng, startAnsicht.lat], zoom: startAnsicht.zoom });
    } else {
      map.fitBounds(
        [
          [startAnsicht.west, startAnsicht.sued],
          [startAnsicht.ost, startAnsicht.nord],
        ],
        { padding: 60, maxZoom: PUNKT_ZOOM, duration: 0 },
      );
    }
  }, [startAnsicht]);

  // fly-to bei Auswahl.
  useEffect(() => {
    const map = mapRef.current;
    if (map && flyToZiel) {
      startAufKarteRef.current = map;
      map.flyTo({ center: [flyToZiel.lng, flyToZiel.lat] as LngLatLike, zoom: 15 });
    }
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
    return () => {
      map.off('click', 'abschnitte-fill', handler);
    };
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
    map.on('click', 'zonen-line-gestrichelt', handler);
    return () => {
      map.off('click', 'zonen-fill', handler);
      map.off('click', 'zonen-line', handler);
      map.off('click', 'zonen-line-gestrichelt', handler);
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
    const marker = baueMarkerFc(markers, markerPlakette);
    const einsatzort = baueEinsatzortFc(markers, markerPlakette);
    markerDatenRef.current = marker;
    einsatzortDatenRef.current = einsatzort;
    // Registry für styleimagemissing füllen (Key → TzProps). tzIconKey ist die EINE Quelle der
    // Key-Bildung (identisch zum icon-Property aus baueMarkerFc) → DRY.
    const registry = new Map<string, TzProps>();
    for (const mk of markers) {
      if (mk.tz) registry.set(tzIconKey(mk.tz), mk.tz);
    }
    tzRegistryRef.current = registry;
    wendeKartenDatenAn(map, () =>
      reAnlegenMarker(map, markerDatenRef.current, einsatzortDatenRef.current),
    );
    // Cluster-Zusammensetzung kann sich geändert haben → DOM-Donuts verwerfen; der render-Sync baut
    // sie mit frischen Typ-Counts neu auf (ein wiederverwendeter cluster_id zeigte sonst stale Segmente).
    for (const id in clusterDomOnScreenRef.current) clusterDomOnScreenRef.current[id].remove();
    clusterDomOnScreenRef.current = {};
    clusterDomRef.current = {};
    // Offener Spider hielte einen veralteten getClusterLeaves-Snapshot (cluster_ids ändern sich) →
    // bei jeder Daten-Änderung (SSE/Query-Invalidation) einklappen.
    schliesseSpiderRef.current?.();
  }, [markers, markerPlakette]);

  // Einzel-Marker-Klick → Inspector (schluessel) + Cursor. Cluster-Klick läuft über die
  // DOM-Donut-Marker (eigener Effekt unten).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    // EIN Handler über alle Klickebenen, nicht einer je Ebene (Review LFH-650): je Ebene feuerte
    // ein Tipp, der Kreis, Kurzzeichen und Trefferzone zugleich trifft, `onMarkerKlick` bis zu
    // dreimal — seit den überlappenden Trefferzonen womöglich mit VERSCHIEDENEN Schlüsseln.
    // Gewählt wird das Merkmal, das dem Klickpunkt am nächsten liegt.
    const klickMarker = (e: maplibregl.MapLayerMouseEvent) => {
      const merkmal = naechstesMerkmal(e.features ?? [], e.point, (ll) => map.project(ll));
      const schluessel = merkmal?.properties?.schluessel;
      if (typeof schluessel === 'string') onMarkerKlick?.(schluessel);
    };
    const enter = () => {
      map.getCanvas().style.cursor = 'pointer';
    };
    const leave = () => {
      map.getCanvas().style.cursor = '';
    };
    // Aufgefächerte Spider-Leaves verhalten sich wie Einzelmarker (Klick → onMarkerKlick, Cursor).
    const klickLayer = [...MARKER_KLICK_LAYER, ...SPIDER_KLICK_LAYER];
    map.on('click', klickLayer, klickMarker);
    map.on('mouseenter', klickLayer, enter);
    map.on('mouseleave', klickLayer, leave);
    return () => {
      map.off('click', klickLayer, klickMarker);
      map.off('mouseenter', klickLayer, enter);
      map.off('mouseleave', klickLayer, leave);
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
      // Solange Kacheln nachladen, bleiben die stehenden Donuts, wie sie sind — sonst flackerten
      // sie bei jedem Zoom/Pan weg und wieder her (Review-Befund LFH-648).
      if (!map.isSourceLoaded(MARKER_CLUSTER_QUELLE)) return;
      const neu: Record<string, maplibregl.Marker> = {};
      for (const f of map.querySourceFeatures(MARKER_CLUSTER_QUELLE)) {
        const props = f.properties as Record<string, unknown>;
        if (!props.cluster) continue;
        const clusterId = Number(props.cluster_id);
        // Derselbe Schlüssel wie der offene Spider (`spiderOffenRef`): die Hülle eines Donuts
        // (LFH-650) findet so ihren Cluster wieder.
        const id = clusterSchluessel(MARKER_CLUSTER_QUELLE, clusterId);
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
            oeffneSpiderRef.current?.(
              MARKER_CLUSTER_QUELLE,
              clusterId,
              coords,
              Number(props.point_count ?? 0),
            );
          });
          marker = new maplibregl.Marker({ element: el }).setLngLat(coords);
          clusterDomRef.current[id] = marker;
        }
        neu[id] = marker;
        if (!clusterDomOnScreenRef.current[id]) marker.addTo(map);
      }
      for (const id in clusterDomOnScreenRef.current) {
        if (!neu[id]) {
          clusterDomOnScreenRef.current[id].remove();
          delete clusterDomRef.current[id];
        }
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
      spiderTokenRef.current++; // in-flight getClusterLeaves entwerten (load-bearing)
      if (spiderOffenRef.current === null) return;
      setzeHuelleDurchlaessig(clusterDomRef.current[spiderOffenRef.current]?.getElement(), false);
      spiderOffenRef.current = null;
      // mapRef wird im Map-Cleanup ZUERST genullt (Effekt-Reihenfolge) → beim Unmount mit offenem
      // Spider ist die Map schon entfernt; getSource würfe sonst (kein internes Guard). Token-Bump
      // läuft trotzdem, damit kein in-flight-Lauf nach dem Unmount noch malt.
      if (mapRef.current) setzeSpiderDaten(map, leer, leer);
    };

    const oeffne = (
      quelle: (typeof CLUSTER_QUELLEN)[number],
      clusterId: number,
      center: [number, number],
      anzahl: number,
    ) => {
      const schluessel = clusterSchluessel(quelle, clusterId);
      if (spiderOffenRef.current === schluessel) {
        schliesse();
        return;
      } // Toggle / erneuter Klick
      schliesse(); // A→B: A einklappen
      // Die Quelle des geklickten Donuts fragen: ein Personen-Cluster kennt `marker-cluster`
      // nicht (LFH-648). Die Spider-Quellen bleiben gemeinsam — offen ist höchstens einer.
      const src = map.getSource(quelle) as GeoJSONSource | undefined;
      if (!src) return;
      // Großcluster → Fallback: reinzoomen (verkleinert Cluster, dann erneut auffächerbar).
      if (anzahl > SPIDER_CAP) {
        src
          .getClusterExpansionZoom(clusterId)
          .then((zoom) => map.easeTo({ center, zoom }))
          .catch(() => {
            /* Cluster nach Daten-Update weg → ignorieren */
          });
        return;
      }
      const token = ++spiderTokenRef.current;
      src
        .getClusterLeaves(clusterId, SPIDER_CAP, 0)
        .then((leaves) => {
          if (token !== spiderTokenRef.current) return; // stale (anderer Cluster geklickt / eingeklappt)
          const projektor: SpiderProjektor = {
            project: (ll) => map.project(ll),
            unproject: (px) => map.unproject([px.x, px.y]),
          };
          const props = leaves.map((f) => f.properties as MarkerProps);
          const { leaves: leafFc, legs } = baueSpiderFc(props, center, projektor);
          setzeSpiderDaten(map, leafFc, legs);
          spiderOffenRef.current = schluessel;
          setzeHuelleDurchlaessig(clusterDomRef.current[schluessel]?.getElement(), true);
        })
        .catch(() => {
          /* Cluster nach Daten-Update weg → ignorieren */
        });
    };

    oeffneSpiderRef.current = oeffne;
    schliesseSpiderRef.current = schliesse;

    const aufKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') schliesse();
    };
    // Karten-Klick: ein Personen-Cluster (WebGL-Layer, LFH-648) fächert auf — aber nur, wenn er
    // das OBERSTE Feature am Punkt ist. Jeder andere Klick klappt ein wie bisher (leerer Klick,
    // Leaf-Routing, Klick auf ein Kräfte-Zeichen über dem Cluster).
    const klick = (e: maplibregl.MapMouseEvent) => {
      const layers = [
        ...MARKER_KLICK_LAYER,
        ...SPIDER_KLICK_LAYER,
        ...PERSONEN_CLUSTER_KLICK_LAYER,
      ].filter((id) => map.getLayer(id));
      const treffer = layers.length
        ? personenClusterTreffer(map.queryRenderedFeatures(e.point, { layers }))
        : null;
      if (treffer)
        oeffne(PERSONEN_CLUSTER_QUELLE, treffer.clusterId, treffer.center, treffer.anzahl);
      else schliesse();
    };
    const zeiger = (an: boolean) => () => {
      map.getCanvas().style.cursor = an ? 'pointer' : '';
    };
    const rein = zeiger(true);
    const raus = zeiger(false);
    map.on('movestart', schliesse); // jede Karten-Bewegung/Zoom klappt ein
    map.on('click', klick);
    for (const id of PERSONEN_CLUSTER_KLICK_LAYER) {
      map.on('mouseenter', id, rein);
      map.on('mouseleave', id, raus);
    }
    window.addEventListener('keydown', aufKey);
    return () => {
      map.off('movestart', schliesse);
      map.off('click', klick);
      for (const id of PERSONEN_CLUSTER_KLICK_LAYER) {
        map.off('mouseenter', id, rein);
        map.off('mouseleave', id, raus);
      }
      window.removeEventListener('keydown', aufKey);
      schliesse();
    };
  }, []);

  // Viewport nach Kartenbewegung melden: Zoom (für „näher heranzoomen"-Hinweise) immer,
  // bbox nur ab BBOX_MIN_ZOOM. KRITIS selbst bräuchte das Gate seit LFH-83 nicht mehr (der
  // Server verdichtet große Ausschnitte aus dem Extrakt zu Sammelpunkten, keine Overpass-Anfrage
  // mehr) — aber Energie (LFH-81) fragt für `power=plant` weiterhin LIVE bei Overpass an, und
  // der Handler ist für alle bbox-abhängigen Ebenen gemeinsam. Das Gate bleibt deshalb an, es
  // schützt jetzt Energie vor einer Welt-weiten Anfrage.

  useEffect(() => {
    const map = mapRef.current;
    if (!map || (!onBboxAenderung && !onZoomAenderung)) return;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const verarbeite = () => {
      const zoom = map.getZoom();
      onZoomAenderung?.(zoom);
      if (onBboxAenderung && zoom >= BBOX_MIN_ZOOM) {
        const b = map.getBounds();
        onBboxAenderung(`${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}`);
      }
    };

    const melde = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(verarbeite, 600);
    };

    verarbeite(); // initial (z. B. wenn eine bbox-Ebene aktiviert wird, während die Karte bereits passend gezoomt ist)
    map.on('moveend', melde);
    return () => {
      if (timer) clearTimeout(timer);
      map.off('moveend', melde);
    };
  }, [onBboxAenderung, onZoomAenderung]);

  // Klick auf ein Fachebenen-Objekt → meldet Properties + Quelle nach oben (Detail-Panel).
  // Handler je aktivem anklickbaren Layer (Closure über die Quelle); Cursor wird zur Hand.
  // Gebündelte Ebenen (KRITIS, LFH-83): ein Bündel oder Server-Sammelpunkt zoomt hinein, statt
  // ein Detail-Panel zu öffnen — die Unterscheidung trifft `entscheideFachebeneKlick`.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const binds = (fachebenen ?? [])
      .flatMap((fe) => fachebeneClickLayerIds(fe.def).map((id) => ({ id, fe })))
      .map(({ id, fe }) => {
        const quelle = fe.def.key;
        const klick = (e: maplibregl.MapLayerMouseEvent) => {
          const feature = e.features?.[0];
          const props = (feature?.properties ?? {}) as Record<string, unknown>;
          // Nur gebündelte Ebenen kennen Bündel und Sammelpunkte; jede andere bleibt beim
          // Detail-Panel, egal was ihre Properties tragen.
          const ziel: FachebeneKlickZiel = fe.def.buendeln
            ? entscheideFachebeneKlick(props)
            : { art: 'einzel' };
          if (ziel.art !== 'einzel') {
            // Mittelpunkt aus dem Feature (Punktgeometrie), nicht aus dem Klickort — sonst
            // zöge das Hineinzoomen den Bündelrand statt des Bündels in die Bildmitte.
            const g = feature?.geometry;
            const center: [number, number] =
              g?.type === 'Point'
                ? [g.coordinates[0], g.coordinates[1]]
                : [e.lngLat.lng, e.lngLat.lat];
            if (ziel.art === 'buendel') {
              const src = map.getSource(fachebeneSourceId(quelle)) as GeoJSONSource | undefined;
              src
                ?.getClusterExpansionZoom(ziel.clusterId)
                .then((zoom) => map.easeTo({ center, zoom }))
                .catch(() => {
                  /* Bündel nach Daten-Update weg → ignorieren */
                });
            } else {
              map.easeTo({ center, zoom: map.getZoom() + ziel.zoomSchritt });
            }
            return;
          }
          // Properties und volle Geometrie aus DEMSELBEN Feature (LFH-282, siehe
          // `werteFachebenenKlickAus`).
          const aus = werteFachebenenKlickAus(
            feature,
            { lng: e.lngLat.lng, lat: e.lngLat.lat },
            fe.daten,
          );
          onFachebeneKlick?.(aus.props, quelle, aus.geometrie);
        };
        const enter = () => {
          map.getCanvas().style.cursor = 'pointer';
        };
        const leave = () => {
          map.getCanvas().style.cursor = '';
        };
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
        drawRef.current = createZeichnung(
          map,
          (g) => {
            if (g.type === 'Polygon') onFlaecheGezeichnetRef.current?.(g);
          },
          (bereit) => onZeichnenBereitAenderungRef.current?.(bereit),
          'td-abschnitt',
        );
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
        zoneDrawRef.current = createZeichnung(
          map,
          (g) => onZoneGezeichnetRef.current?.(g),
          (bereit) => onZeichnenBereitAenderungRef.current?.(bereit),
          'td-zone',
        );
      }
      zoneDrawRef.current.starten(zoneZeichnen);
    } else if (zoneDrawRef.current) {
      zoneDrawRef.current.stoppen();
    }
    // zoneZeichnenNonce wird hier nicht gelesen — sie erzwingt bewusst ein Re-Fire bei
    // gleich bleibendem Modus (Zone→Zone-Wechsel), damit starten() einen offenen Entwurf verwirft.
  }, [zoneZeichnen, zoneZeichnenNonce]);

  // Messen an-/abschalten bzw. die Form wechseln; `starten` verwirft dabei die alte Figur.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (messen) {
      if (!messRef.current) {
        messRef.current = createMessung(map, (g, fertig) => onMessungRef.current?.(g, fertig));
      }
      messRef.current.starten(messen);
    } else if (messRef.current) {
      messRef.current.stoppen();
    }
  }, [messen]);

  // Controller bei Unmount sauber zerstören.
  useEffect(
    () => () => {
      drawRef.current?.zerstoeren();
      drawRef.current = null;
      zoneDrawRef.current?.zerstoeren();
      zoneDrawRef.current = null;
      messRef.current?.zerstoeren();
      messRef.current = null;
    },
    [],
  );

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

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%' }} data-testid="kartenflaeche" />
  );
});

export default Kartenflaeche;
