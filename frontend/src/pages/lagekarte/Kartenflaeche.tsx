import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
// Namespace-Import: maplibre-gl ab 6 ist ESM ohne Default-Export. Kein named-Import der Klassen:
// `Map` beschattete den globalen `Map`, den die Zeichen-Registry als
// `useRef<Map<string, ZeichenQuelle>>` nutzt. `import * as ns, { type X }` ist kein gültiges ES,
// daher zwei Zeilen.
import * as maplibregl from 'maplibre-gl';
import type { LngLatLike, StyleSpecification, GeoJSONSource } from 'maplibre-gl';
// Der Worker muss explizit verdrahtet werden, mit `?worker&url`, nicht `?url`: maplibre 6 baut die
// Worker-URL zur Laufzeit zusammen, was kein Bundler sieht — ohne das emittiert `vite build` die
// Worker-Datei nicht (exit 0, keine Warnung), und es kommt keine Kachel. `?url` allein emittiert
// eine Datei, die ihre Geschwisterdatei `maplibre-gl-shared.mjs` importiert und daran stirbt.
// `?worker&url` bündelt self-contained und landet im Workbox-Precache (offline da).
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { addSymbolImage } from '@einsatzzeichen/maplibre';
// Nur noch für freie Zeichen (`tz|`), bis LFH-836 sie auf @einsatzzeichen umstellt.
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
  SPIDER_KLICK_LAYER,
  setzeSpiderDaten,
  type MarkerFeatureCollection,
  type MarkerProps,
} from './markerLayer';
import {
  aktualisiereSpiderBlaetter,
  baueSpiderFc,
  nurInhaltGeaendert,
  SPIDER_CAP,
  type SpiderProjektor,
} from './spiderfy';
import {
  baueZeichenRegistry,
  kartenPixelRatio,
  ZEICHEN_KARTEN_PX,
  type ZeichenQuelle,
} from './markerIcons';
import { baueClusterDonut, setzeHuelleDurchlaessig } from './clusterDonut';
import type { GeoJsonPolygon, GeoJsonGeometry } from './geo';
import { werteFachebenenKlickAus } from './geo';
import { createZeichnung, type Zeichnung, type ZeichenModus, type ZeichenStand } from './zeichnen';
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
import {
  ABSCHNITT_KLICK_LAYER,
  ZONEN_KLICK_LAYER,
  entscheideKlickziel,
  ordneKlickebene,
  type Flaechenziel,
  type Klickziel,
} from './klickziel';
import { fachebeneQuelleVon, flaechenKennung } from './flaechenwahl';
import FlaechenwahlMenue from './FlaechenwahlMenue';
import { synchronisiereBildLayer, entferneBildLayer, type BildOverlay } from './bildLayer';
import { eckenInitialPixel, type Punkt } from './bildGeometrie';
import { erzeugeBildHandles, type BildHandles } from './bildHandles';
import type { GriffKontext, GriffModus, KantenAus } from './bildGriffe';
import type { Ecken } from '../../api/kartenbilder';
import { BBOX_MIN_ZOOM } from './fachebenen';
import type { FachebeneQuelle } from '../../api/fachebenen';
import { PUNKT_ZOOM, type StartAnsicht } from './startAnsicht';
import { zonenPlakette } from './plakette';
import { useRollen } from '../../components/instrument/rollenwerte';
import { eigenpositionFc, sorgeFuerEigenpositionLayer } from './eigenpositionLayer';
import type { Eigenposition } from './useEigenposition';

// Worker-URL setzen, bevor die erste Map entsteht (nur diese Datei erzeugt eine). Der Guard deckt
// eine Bruchlinie ab: maplibre nimmt `config.WORKER_URL || defaultWorkerUrl()`. Bei einem falsy
// Wert fiele es still auf seinen Default zurück — der funktioniert unter Dev, zeigt im Prod-Build
// aber ins Leere, und die Karte lädt keine Kachel. Lieber hier laut brechen.
if (!workerUrl)
  throw new Error('maplibre-Worker-URL ist leer — `?worker&url` hat nichts geliefert');
maplibregl.setWorkerUrl(workerUrl);

/** Ein Aufruf von `transformRequest`: was MapLibre wollte (`ein`) und was es bekam (`aus`). */
interface KartenAnfrage {
  ein: string;
  aus: string;
}
/**
 * Obergrenze des DEV-Mitschnitts — eine offene Karte holt Kacheln im Sekundentakt. 40 reichen: die
 * Zusicherungen prüfen den ersten Lauf.
 */
const ANFRAGEN_DECKEL = 40;

/**
 * `transformRequest` der Karte — plus DEV-Mitschnitt unter `window.__lfhKartenAnfragen`.
 *
 * Die Absolutierung der root-relativen Proxy-URLs ist vom Netz aus nicht beobachtbar: maplibre
 * fetcht im Worker über `new Request(url)` und löst gegen `self.location` des Worker-Skripts auf,
 * das bei uns same-origin liegt. Tragend ist sie trotzdem: bei cross-origin Worker-URL baut
 * maplibre den Worker aus einem Blob, dessen `self.location` opak ist — „Failed to parse URL"
 * (LFH-182). Wer Assets auf ein CDN legt, fällt ohne diese Zeile hinein.
 *
 * Der Mitschnitt ist deshalb die einzige Stelle, an der „läuft der Seam?" widerlegbar ist. Im
 * Prod-Build fällt der Zweig heraus (`import.meta.env.DEV` ist `false`).
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

// Re-Export: LagekartePage importiert ZoneFeature aus Kartenflaeche.
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
   * Startansicht aus den Einsatzdaten (`startAnsicht.ts`). `undefined` = noch nicht entschieden,
   * `null` = nichts verortet, Übersicht behalten. Greift genau einmal je Karte: danach gehört der
   * Ausschnitt der Bedienung. Ein früherer `flyToZiel` (Deeplink) verbraucht sie ebenfalls.
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
  /**
   * Steigt bei jedem Zonen-Zeichnen-Start; erzwingt ein Re-Fire des Effekts auch bei gleichem
   * Modus, damit `starten()` einen offenen Entwurf verwirft.
   */
  zoneZeichnenNonce?: number;
  /** Callback nach abgeschlossenem Zeichnen einer Zone. */
  onZoneGezeichnet?: (geometrie: GeoJsonGeometry) => void;
  /**
   * Stand der laufenden Abschnitts-/Zonen-Figur: Punktzahl, „Abschließen" frei, „Letzten Punkt
   * zurück" frei. Gemeldet bei jeder Änderung.
   */
  onZeichnenStandAenderung?: (stand: ZeichenStand) => void;
  /** Klick auf eine Zone → Inspector. */
  onZoneKlick?: (id: number) => void;
  /**
   * Liegen am Tipppunkt mehrere Flächen, öffnet sich ein Auswahlmenü (LFH-812). Aus in einem
   * exklusiven Modus (Zeichnen, Messen, Platzieren) — dort gehört der Tipp dem Modus. Vorgabe aus.
   */
  flaechenwahl?: boolean;
  /** Messwerkzeug: aktive Form oder `null`. */
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
  /**
   * Klick auf ein Fachebenen-Objekt → Properties + Quelle + volle, ungeclippte Geometrie aus der
   * geladenen FeatureCollection.
   */
  onFachebeneKlick?: (
    properties: Record<string, unknown>,
    quelle: FachebeneQuelle,
    geometrie?: { type: string; coordinates: unknown } | null,
  ) => void;
  /** Aktiv zu platzierendes Bild (null = kein Platzier-Modus). Zeigt Mittelpunkt-Drag-Handle. */
  platzierBild?: { id: number; ecken: Ecken } | null;
  /** Callback, wenn Platzier-Geometrie per Drag verändert wurde. */
  onPlatzierGeometrie?: (ecken: Ecken) => void;
  /**
   * Welche Griffsorte im Platzier-Modus scharf ist, Vorgabe `groesse` (Ecken und Kanten). Alle zehn
   * Griffe in Fingergröße lägen auf einem kleinen Bild übereinander.
   */
  griffModus?: GriffModus;
  /** Meldet, wie viele Kanten die Griffe mangels Platz ausblenden (LFH-764, `scharfeGriffe`). */
  onGriffStand?: (stand: { kantenAus: KantenAus }) => void;
  /** Zeigerlage über der Karte (Koordinatenanzeige); `null`, sobald er die Karte verlässt. */
  onZeigerLage?: (lage: { lat: number; lon: number } | null) => void;
  /**
   * Meldet, ob ein Bündel aufgefächert ist: `true`, sobald die Blätter stehen, `false` beim
   * Zuklappen. Ein Wechsel A→B meldet kein Zwischen-`false`. Die Betroffenen-Karte hält daran ihre
   * Schleuse (LFH-668, Touch-Fall).
   */
  onSpiderOffen?: (offen: boolean) => void;
  /**
   * Ziel-Element der Maßstabsleiste. MapLibres `ScaleControl` hinge sonst absolut in seiner Ecke,
   * genau dort, wo `KartenFuss` die Bänder im Fluss stapelt — deshalb über `onAdd`/`onRemove` in
   * ein Band des Fußes gehängt.
   */
  massstabZiel?: HTMLElement | null;
  /**
   * Eigener Gerätestandort als Punkt mit Genauigkeitskreis; `null` = aus. Nur Darstellung — das
   * Anfliegen übernimmt die Seite über `flyToZiel`.
   */
  eigenposition?: Eigenposition | null;
}

/** Imperative Karten-API für die Page: Upload-Platzierung + Auf-Bild-Zentrieren. */
export interface KartenHandle {
  /**
   * Initiale Bild-Ecken für einen Upload: achsenparalleles Rechteck mittig im Viewport, Breite ~50
   * % der kürzeren Kante, Seitenverhältnis `ar`.
   */
  initialeEckenFuerBild(ar: number): Ecken | null;
  /** Karte auf die Bild-Ecken einpassen (fitBounds). */
  zentriereAufEcken(ecken: Ecken): void;
  /** Aktives Zonen-Zeichnen abschließen (native Finish-Geste). No-op, wenn nicht aktiv. */
  zoneAbschliessen(): boolean;
  /** Aktives Abschnitt-Zeichnen abschließen. No-op, wenn nicht aktiv. */
  abschnittAbschliessen(): boolean;
  /** Zuletzt gesetzten Punkt der laufenden Figur zurücknehmen; false ohne Punkt. */
  punktZurueck(): boolean;
  /** Angefangene Figur verwerfen, im Zeichenmodus bleiben (erste Esc-Stufe). */
  zeichnungVerwerfen(): void;
  /** Laufende Messung abschließen; false bei zu wenigen Punkten. */
  messungAbschliessen(): boolean;
  /** Messung verwerfen und in derselben Form neu beginnen. */
  neuMessen(): void;
  /** Eine Zoomstufe hinein/heraus — die Knöpfe der Überlagerung ersetzen `NavigationControl`. */
  zoomRein(): void;
  zoomRaus(): void;
  /** Drehung und Neigung zurücksetzen (Nordung) — der Kompass des alten `NavigationControl`. */
  nachNorden(): void;
  /** Ein aufgefächertes Bündel einklappen (meldet `onSpiderOffen(false)`); sonst nichts. */
  klappeSpiderEin(): void;
}

const klickzielJeTipp = new WeakMap<Event, Klickziel<maplibregl.MapGeoJSONFeature> | null>();

/**
 * Wem ein Tipp gehört (LFH-764, `klickziel.ts`). Jeder Klick-Hörer der Karte fragt hier und handelt
 * nur als Gewinner — sonst wählte derselbe Tipp Marker UND Zone aus, oder `easeTo` ins KRITIS-Bündel
 * liefe gegen `flyTo` zum Marker daneben. Gefragt wird über ALLE vorhandenen Klickebenen, einmal je
 * Tipp: die Hörer eines Tipps teilen über das Originalereignis dasselbe Urteil.
 */
function klickzielAm(map: maplibregl.Map, e: maplibregl.MapMouseEvent) {
  const schon = klickzielJeTipp.get(e.originalEvent);
  if (schon !== undefined) return schon;
  const layers = map.getLayersOrder().filter((id) => ordneKlickebene(id) !== null);
  const ziel = layers.length
    ? entscheideKlickziel(map.queryRenderedFeatures(e.point, { layers }), e.point, (ll) =>
        map.project(ll),
      )
    : null;
  klickzielJeTipp.set(e.originalEvent, ziel);
  return ziel;
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
    flaechenwahl = false,
    messen,
    onMessung,
    onZeichnenStandAenderung,
    eigenposition,
    fachebenen,
    onBboxAenderung,
    onZoomAenderung,
    onFachebeneKlick,
    bilder,
    platzierBild,
    onPlatzierGeometrie,
    griffModus,
    onGriffStand,
    onZeigerLage,
    onSpiderOffen,
    massstabZiel,
    startAnsicht,
  },
  ref,
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  // Namensplaketten der Marker in den Rollen des aktiven Modus — dieselbe Plakette wie an den
  // Zonen. `rollen` ist eine Paletten-Konstante, also stabil.
  const { rollen, token } = useRollen();
  const markerPlakette = useMemo(() => zonenPlakette(rollen), [rollen]);
  // Aktuelle Marker-Daten als FeatureCollections; nach setStyle re-angelegt (analog flaechenDatenRef).
  const markerDatenRef = useRef<MarkerFeatureCollection>({
    type: 'FeatureCollection',
    features: [],
  });
  // Der zuletzt tatsächlich per `setData` eingespielte Stand: `wendeKartenDatenAn` kann vertagen,
  // und ein Spider kann im Fenster dazwischen aufgehen (LFH-668, Review).
  const markerAngewandtRef = useRef<MarkerFeatureCollection>(markerDatenRef.current);
  const einsatzortDatenRef = useRef<MarkerFeatureCollection>({
    type: 'FeatureCollection',
    features: [],
  });
  // Eigenposition: zuletzt gezeichnete Daten + Farbe, nach setStyle re-angelegt.
  const eigenpositionRef = useRef({ daten: eigenpositionFc(null), farbe: rollen.bedien });
  // Image-Key → Zeichenquelle; Resolver (`ez|`) und styleimagemissing-Handler (`tz|`) erzeugen
  // daraus lazy die Karten-Icons.
  const zeichenRegistryRef = useRef<Map<string, ZeichenQuelle>>(new Map());
  // Cluster-DOM-Donut-Marker (`clusterSchluessel` → Marker): alle bekannten bzw. aktuell auf der
  // Karte. Nur für `marker-cluster` — Personen-Cluster sind WebGL-Layer, damit sie unter den
  // Kräften liegen.
  const clusterDomRef = useRef<Record<string, maplibregl.Marker>>({});
  const clusterDomOnScreenRef = useRef<Record<string, maplibregl.Marker>>({});
  // Offener Spider: Cluster-Schlüssel oder null. `spiderTokenRef` entwertet laufende
  // `getClusterLeaves` (schneller A→B-Wechsel darf nicht A's Leaves über B malen).
  const spiderOffenRef = useRef<string | null>(null);
  const spiderTokenRef = useRef(0);
  // Was der offene Spider zeigt — eine reine Inhaltsänderung schreibt die Blätter daraus neu, statt
  // zuzuklappen (LFH-668, D5).
  const spiderDatenRef = useRef<{
    leaves: MarkerFeatureCollection;
    legs: { type: 'FeatureCollection'; features: unknown[] };
  } | null>(null);
  const onSpiderOffenRef = useRef(onSpiderOffen);
  onSpiderOffenRef.current = onSpiderOffen;
  // Controller-Funktionen als Refs, damit Donut-Klickhandler und Effekte sie aufrufen können, ohne
  // neu zu binden.
  const oeffneSpiderRef = useRef<
    (
      quelle: (typeof CLUSTER_QUELLEN)[number],
      clusterId: number,
      center: [number, number],
      anzahl: number,
    ) => void
  >(() => {});
  const schliesseSpiderRef = useRef<() => void>(() => {});
  // Entscheidet, welches error-Event die Basemap abstuft: Kachel-Fehler nie, höchstens eine
  // Abstufung je angewandtem Style, nach dem Laden keine mehr.
  const stilWaechterRef = useRef(neuerStilFehlerWaechter());
  // Eigene AttributionControl, damit `customAttribution` je View gesetzt werden kann — bei Wechsel
  // entfernt und neu angelegt.
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
  // Zuletzt angewandter Style: der Konstruktor wendet den initialen an, der [style]-Effekt reagiert
  // nur auf echte Wechsel (sonst lüde `diff: false` beim Mount alles neu).
  const angewandterStyleRef = useRef(style);
  // Zeichen-Controller (terra-draw) über Renders hinweg.
  const drawRef = useRef<Zeichnung | null>(null);
  // Eigener Zeichen-Controller für Zonen (Polygon ODER Linie).
  const zoneDrawRef = useRef<Zeichnung | null>(null);
  // Stabil halten, damit eine neue Identität den Draw nicht mitten im Zeichnen neu aufsetzt.
  const onFlaecheGezeichnetRef = useRef(onFlaecheGezeichnet);
  onFlaecheGezeichnetRef.current = onFlaecheGezeichnet;
  const onZoneGezeichnetRef = useRef(onZoneGezeichnet);
  onZoneGezeichnetRef.current = onZoneGezeichnet;
  const onZeichnenStandAenderungRef = useRef(onZeichnenStandAenderung);
  onZeichnenStandAenderungRef.current = onZeichnenStandAenderung;
  // Welcher Controller zeichnet, sagen die Props — der Handle fragt genau diesen (Zone vor
  // Abschnitt; beide zugleich lässt der Modus-Reducer nicht zu).
  const zeichnenArtRef = useRef({ zeichnen, zoneZeichnen });
  zeichnenArtRef.current = { zeichnen, zoneZeichnen };
  // Dritter Controller: Messen. Eigene Instanz, weil er bei jeder Änderung meldet statt erst beim
  // Abschluss (`messZeichnung.ts`).
  const messRef = useRef<MessZeichnung | null>(null);
  const onMessungRef = useRef(onMessung);
  onMessungRef.current = onMessung;
  const messenRef = useRef(messen);
  messenRef.current = messen;

  // Imperative API für die Page: Upload-Platzierung und Auf-Bild-Zentrieren. Pixel-Raum via
  // project/unproject — exakt, ohne cos(lat)-Verzerrung.
  useImperativeHandle(ref, () => {
    const aktiveZeichnung = () =>
      zeichnenArtRef.current.zoneZeichnen
        ? zoneDrawRef.current
        : zeichnenArtRef.current.zeichnen
          ? drawRef.current
          : null;
    return {
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
      punktZurueck() {
        return aktiveZeichnung()?.punktZurueck() ?? false;
      },
      zeichnungVerwerfen() {
        aktiveZeichnung()?.verwerfen();
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
      klappeSpiderEin() {
        schliesseSpiderRef.current();
      },
    };
  }, []);

  // Karte einmalig erzeugen.
  useEffect(() => {
    if (!containerRef.current) return;
    // Mitschnitt vor dem Konstruktor leeren: `transformRequest` feuert schon für Style und Glyphs,
    // während `new maplibregl.Map` läuft. Sonst läse ein Test Einträge einer entfernten Karte.
    if (import.meta.env.DEV)
      (window as unknown as { __lfhKartenAnfragen?: KartenAnfrage[] }).__lfhKartenAnfragen = [];
    const map = new maplibregl.Map({
      container: containerRef.current,
      style,
      center: [10.45, 51.16], // Mitte DE als neutraler Start
      zoom: 5,
      attributionControl: false,
      // maplibre 6 setzt hier per Vorgabe 4 — die effektive Kachel-maxzoom wäre dann
      // max(source.maxzoom, maxZoom-4), unsere Offline-Weltübersicht (maxzoom 6) würde für z7–18
      // client-seitig gesliced. Das ändert die Label-Platzierung und kostet auf Feldgeräten CPU und
      // Speicher. `undefined` stellt das v5-Verhalten her (der Konstruktor merged per Spread). Wer
      // Overscaling will, setzt eine Zahl und prüft die Beschriftung auf einem echten Gerät.
      zoomLevelsToOverscale: undefined,
      // Proxy-URLs (/api/karte/proxy/…) sind root-relativ und scheitern in einem Blob-Worker ohne
      // Base — siehe `transformiereKartenAnfrage`.
      transformRequest: transformiereKartenAnfrage,
      // Eine Lagekarte bleibt Draufsicht (auch die Betroffenen-Karte): Drehen per Pinch bleibt,
      // „Nach Norden ausrichten" holt die Ausrichtung zurück; Kippen nicht. Zwei Angaben, gemessen
      // in `e2e/lagekarte-touch.spec.ts`: `touchPitch: false` schaltet die Zwei-Finger-Kippgeste ab
      // (ihr Erkenner schluckte sonst den Verschiebe-Zug), `maxPitch: 0` deckelt die Neigung und
      // schließt die übrigen Wege (Umschalt+↑), ohne das Drehen abzuschalten.
      touchPitch: false,
      maxPitch: 0,
    });
    // Kein `NavigationControl`: Zoom, Nordung und Zeichnen stehen im Knopfblock der Überlagerung.
    //
    // Das Fenster der Basemap-Abstufung schließt bei 'style.load', nicht bei 'load': 'load' wartet
    // auf alle sichtbaren Kacheln, 'style.load' feuert, sobald das Style-JSON angewandt ist — und
    // bei gescheitertem Style-Fetch gar nicht (dort kommt ein ErrorEvent).
    map.on('style.load', () => {
      stilWaechterRef.current.stilGeladen();
    });
    map.on('load', () => {
      sorgeFuerAbschnittLayer(map, flaechenDatenRef.current);
      sorgeFuerZonenLayer(map, zonenDatenRef.current);
      for (const fe of fachebenenRef.current) {
        sorgeFuerFachebeneLayer(map, fe.def, fe.daten, fe.farbe, fe.treffer);
      }
      synchronisiereBildLayer(map, bilderRef.current, 'abschnitte-fill');
    });
    // Fachobjekte (@einsatzzeichen, LFH-835) über den Resolver, NICHT über `styleimagemissing`:
    // MapLibre 6 baut die Bildantwort einer Kachel, bevor es das Event feuert — ein dort angelegtes
    // Bild fehlte im laufenden Layout und erschiene erst beim nächsten Neu-Layout (nach einem
    // Stilwechsel ohne neue Daten: nie). Den Resolver wartet MapLibre ab, und er überlebt
    // `setStyle`. Synchron über Canvas, in Bildschirmschärfe, alle gleich groß (der Statusring in
    // markerLayer.ts ist auf ZEICHEN_KARTEN_PX abgestimmt).
    map.setMissingStyleImageResolver((id) => {
      if (!id.startsWith('ez|')) return;
      const quelle = zeichenRegistryRef.current.get(id);
      if (quelle?.art !== 'ez' || map.hasImage(id)) return;
      try {
        addSymbolImage(map, id, quelle.drawing, {
          size: ZEICHEN_KARTEN_PX,
          pixelRatio: kartenPixelRatio(window.devicePixelRatio),
        });
      } catch {
        // Kein Bild ist besser als ein Fehler im Resolver; der Marker bleibt klickbar.
      }
    });
    // Taktische Zeichen lazy als Karten-Icons: MapLibre meldet fehlende icon-image-IDs, wir rendern
    // on-demand. Race-Guard, weil das Event während des asynchronen Ladens mehrfach für dieselbe ID
    // feuern kann (sonst wirft addImage "image already exists").
    const ladendeIcons = new Set<string>();
    map.on('styleimagemissing', (e) => {
      const id = e.id;
      // Beschriftungsplakette der Zonen und Marker (9-Slice, Farben in der Id). Nach `setStyle`
      // sind alle Bilder weg; dieser Handler legt sie bei Bedarf neu an.
      if (id.startsWith(PLAKETTE_PRAEFIX)) {
        const bild = plakettenBild(id);
        if (!bild || map.hasImage(id)) return;
        const { width, height, data, ...dehnung } = bild;
        map.addImage(id, { width, height, data }, dehnung);
        return;
      }
      if (!id.startsWith('tz|')) return; // fremde IDs ignorieren
      if (map.hasImage(id) || ladendeIcons.has(id)) return;
      const quelle = zeichenRegistryRef.current.get(id);
      if (quelle?.art !== 'tz') return;
      const tz = quelle.tz;
      // `erzeugeTaktischesZeichen` kann bei nicht DV-102-konformen Werten synchron werfen. Zuerst
      // erzeugen, dann zu `ladendeIcons` hinzufügen — sonst bliebe die id bei einem Throw dauerhaft
      // im Guard und der Fehler flöge ungefangen aus dem MapLibre-Callback.
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
        // Auf einheitliche Marker-Größe normieren (die TZ-SVGs haben je Grundzeichen abweichende
        // Größe); erst so deckt der feste Status-Ring (markerLayer.ts, radius 20) das Symbol ab.
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
    // Testhaken für den Browser-Smoke (e2e/lagekarte-smoke.spec.ts): die Karte lebt in WebGL, ein
    // toter Tile-Worker lässt das DOM unverändert, nur `map.loaded()` kippt. Im Prod-Build ist die
    // Zeile weg.
    if (import.meta.env.DEV) (window as unknown as { __lfhKarte?: unknown }).__lfhKarte = map;
    return () => {
      map.remove(); // zerstört auch die AttributionControl
      mapRef.current = null;
      // Testhaken mit abräumen: sonst zeigte er auf eine entfernte Map, und ein späterer Test wäre
      // grün, ohne dass eine Karte lief. (Unter StrictMode zeigt er danach korrekt auf die zweite
      // Instanz.)
      if (import.meta.env.DEV) {
        delete (window as unknown as { __lfhKarte?: unknown }).__lfhKarte;
        // Mitschnitt mit abräumen, aus demselben Grund.
        delete (window as unknown as { __lfhKartenAnfragen?: unknown }).__lfhKartenAnfragen;
      }
      // Ref nullen: sonst ruft der Attribution-Effekt nach StrictMode-Remount `removeControl` auf
      // der entfernten Map.
      attribControlRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Style wechseln (Basemap-Umschalter / Theme / Hydrierung der Ansicht). `stilAngewandt()` öffnet
  // das Abstufungsfenster bis zum `style.load` DIESES Styles, auch nach einem Wechsel von Hand:
  // die Karte entsteht mit dem Blindstil, der Online-Style der Ansicht kommt erst hier an, und
  // sein Ladefehler muss abstufen (LFH-558). Kachel-Fehler zählen nie (`stilFehlerWaechter.ts`).
  //
  // `diff: false` ist Pflicht: per Vorgabe difft setStyle bei URL-/Vektor-Styles asynchron, in
  // diesem Fenster meldet `isStyleLoaded()` den alten Style als geladen, der Poll liefe zu früh,
  // und der spätere Diff wischte unsere Layer weg (nur bei Vektor-Basemaps). `diff: false` setzt
  // synchron einen ungeladenen Style, der Poll vertagt zuverlässig.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (style === angewandterStyleRef.current) return; // Mount: Konstruktor hat ihn schon
    schliesseSpiderRef.current?.(); // setStyle wischt Spider-Sources/Layer → Controller-State sonst stale
    angewandterStyleRef.current = style;
    stilWaechterRef.current.stilAngewandt();
    // Eine laufende Messung überlebt `setStyle` nicht: `diff: false` wirft die Sources des
    // terra-draw-Adapters weg, und der legt sie nicht neu an. Die Messung wird vor dem Wechsel
    // geräumt und danach in derselben Form neu begonnen.
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
    // Zuletzt angemeldet → dieser Poller läuft zuletzt, der Punkt liegt oben.
    wendeKartenDatenAn(map, () =>
      sorgeFuerEigenpositionLayer(
        map,
        eigenpositionRef.current.daten,
        eigenpositionRef.current.farbe,
      ),
    );
  }, [style]);

  // AttributionControl je View neu setzen: MapLibre hat keinen Setter für `customAttribution`.
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
    // Nur der initiale Style-Ladefehler stuft die Basemap ab. MapLibre feuert 'error' auch für
    // einzelne fehlende Tiles, und zwar zwangsläufig vor 'load' (siehe stilFehlerWaechter.ts). Die
    // Klassifikation liegt im Wächter; hier wird verdrahtet und laut protokolliert.
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

  // Zeigerlage melden, über eine Ref, damit eine neue Callback-Identität die Handler nicht bei
  // jedem Render neu bindet.
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

  // Maßstabsleiste (metrisch) in das Band des Kartenfußes hängen: `onAdd` legt das Element an und
  // abonniert `move`, `appendChild` verschiebt es ins Band, `onRemove` räumt ab.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !massstabZiel) return;
    const massstab = new maplibregl.ScaleControl({ maxWidth: 88, unit: 'metric' });
    massstabZiel.appendChild(massstab.onAdd(map));
    return () => {
      massstab.onRemove();
    };
  }, [massstabZiel]);

  // Startansicht einmalig anwenden, vor dem fly-to-Effekt (kommen beide in derselben Runde, gewinnt
  // das fly-to). „Verbraucht" hängt an der Karteninstanz, nicht an einem Boolean: unter StrictMode
  // wird die erste Karte entfernt, ein Boolean-Ref ließe die zweite auf der Übersicht stehen.
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
    // Style noch nicht geladen → auf das nächste idle vertagen, sonst ginge eine frisch gezeichnete
    // Fläche bis zum Reload verloren. Immer aus dem Ref lesen.
    wendeKartenDatenAn(map, () => {
      sorgeFuerAbschnittLayer(map, flaechenDatenRef.current);
      const src = map.getSource('abschnitte') as maplibregl.GeoJSONSource | undefined;
      if (src) src.setData(flaechenDatenRef.current as never);
    });
  }, [flaechen]);

  // Flächen-Auswahlmenü (LFH-812): Liegen am Tipppunkt mehrere Flächen, gewinnt keiner der
  // Flächen-Hörer (`klickzielAm` → `mehrdeutig`); dieser Hörer öffnet stattdessen das Menü. Die
  // Wahl läuft über dieselben Callbacks wie der direkte Tipp. Alles über Refs, damit ein neuer
  // Callback oder Moduswechsel die Hörer nicht neu bindet.
  const [offeneWahl, setOffeneWahl] = useState<{
    nr: number;
    x: number;
    y: number;
    lngLat: { lng: number; lat: number };
    flaechen: Flaechenziel<maplibregl.MapGeoJSONFeature>[];
  } | null>(null);
  const flaechenwahlRef = useRef(flaechenwahl);
  flaechenwahlRef.current = flaechenwahl;
  const flaechenKlickRef = useRef({ onZoneKlick, onFlaecheKlick, onFachebeneKlick });
  flaechenKlickRef.current = { onZoneKlick, onFlaecheKlick, onFachebeneKlick };
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    let nr = 0;
    const klick = (e: maplibregl.MapMouseEvent) => {
      const ziel = klickzielAm(map, e);
      if (ziel?.art !== 'mehrdeutig' || !flaechenwahlRef.current) return;
      nr += 1;
      setOffeneWahl({
        nr,
        x: e.point.x,
        y: e.point.y,
        lngLat: { lng: e.lngLat.lng, lat: e.lngLat.lat },
        flaechen: ziel.flaechen,
      });
    };
    // Der Anker sitzt in Pixeln; bei jeder Kartenbewegung schließt das Menü (wie das Auffächern).
    const schliesse = () => setOffeneWahl(null);
    map.on('click', klick);
    map.on('movestart', schliesse);
    return () => {
      map.off('click', klick);
      map.off('movestart', schliesse);
    };
  }, []);
  // Ein exklusiver Modus beginnt: ein offenes Menü gehört nicht mehr dazu.
  useEffect(() => {
    if (!flaechenwahl) setOffeneWahl(null);
  }, [flaechenwahl]);

  const waehleFlaeche = (
    ziel: Flaechenziel<maplibregl.MapGeoJSONFeature>,
    lngLat: {
      lng: number;
      lat: number;
    },
  ) => {
    const {
      onZoneKlick: zone,
      onFlaecheKlick: abschnitt,
      onFachebeneKlick: fachebene,
    } = flaechenKlickRef.current;
    const id = ziel.merkmal.properties?.id;
    if (ziel.art === 'zone') {
      if (id != null) zone?.(Number(id));
      return;
    }
    if (ziel.art === 'abschnitt') {
      if (id != null) abschnitt?.(Number(id));
      return;
    }
    const quelle = fachebeneQuelleVon(ziel.merkmal.layer.id);
    const fe = fachebenenRef.current.find((f) => f.def.key === quelle);
    if (!quelle || !fe) return;
    const aus = werteFachebenenKlickAus(ziel.merkmal, lngLat, fe.daten);
    fachebene?.(aus.props, quelle, aus.geometrie);
  };

  // Klick auf eine Fläche → Inspector, wenn der Tipp ihr gehört (`klickzielAm`).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const handler = (e: maplibregl.MapLayerMouseEvent) => {
      const ziel = klickzielAm(map, e);
      if (ziel?.art !== 'abschnitt') return;
      const id = ziel.merkmal.properties?.id;
      if (id != null) onFlaecheKlick?.(Number(id));
    };
    map.on('click', ABSCHNITT_KLICK_LAYER, handler);
    return () => {
      map.off('click', ABSCHNITT_KLICK_LAYER, handler);
    };
  }, [onFlaecheKlick]);

  // Zonendaten in die Source spielen (und für setStyle-Re-Anlage merken).
  useEffect(() => {
    const fc = baueZonenFc(zonen);
    zonenDatenRef.current = fc; // unbedingt: load/styledata/idle-Handler lesen daraus
    const map = mapRef.current;
    if (!map) return;
    // Style noch nicht geladen (z. B. während terra-draw seine Layer auf-/abbaut) → auf das nächste
    // idle vertagen. Immer aus dem Ref lesen.
    wendeKartenDatenAn(map, () => {
      sorgeFuerZonenLayer(map, zonenDatenRef.current);
      const src = map.getSource('zonen') as maplibregl.GeoJSONSource | undefined;
      if (src) src.setData(zonenDatenRef.current as never);
    });
  }, [zonen]);

  // Klick auf eine Zone (Fläche ODER Linie) → Inspector, wenn der Tipp ihr gehört. Ein Hörer über
  // alle drei Ebenen: je Ebene feuerte ein Tipp auf Fläche und Linie zweimal.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const handler = (e: maplibregl.MapLayerMouseEvent) => {
      const ziel = klickzielAm(map, e);
      if (ziel?.art !== 'zone') return;
      const id = ziel.merkmal.properties?.id;
      if (id != null) onZoneKlick?.(Number(id));
    };
    const ebenen = [...ZONEN_KLICK_LAYER];
    map.on('click', ebenen, handler);
    return () => {
      map.off('click', ebenen, handler);
    };
  }, [onZoneKlick]);

  // Aktive Fachebenen rendern: Source/Layer sicherstellen, Daten einspielen, inaktive entfernen.
  // Vertagt über `wendeKartenDatenAn`.
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
        sorgeFuerFachebeneLayer(map, fe.def, fe.daten, fe.farbe, fe.treffer);
        setzeFachebeneDaten(map, fe.def.key, fe.daten);
      }
      vorherigeFachebenenRef.current = aktivKeys as Set<string>;
      // Fachebenen-Layer landen oben → Marker erneut nach oben pinnen, sonst verdecken sie die
      // Marker und fangen deren Klicks ab.
      pinneMarkerLayerNachOben(map);
    });
  }, [fachebenen]);

  // Bild-Overlays synchronisieren; `beforeId='abschnitte-fill'` hält sie unter den Vektorlayern.
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

  // Marker als GeoJSON-Layer + Clustering. Als letzter Daten-Effekt registriert → sein Poller läuft
  // zuletzt, die Marker-Layer liegen über Abschnitten/Zonen/Bildern; `sorgeFuerMarkerLayer` pinnt
  // sie zusätzlich nach oben.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const marker = baueMarkerFc(markers, markerPlakette);
    const einsatzort = baueEinsatzortFc(markers, markerPlakette);
    // Nur der Inhalt anders (Sichtung, Status, Beschriftung)? Dann bildet die Quelle dieselben
    // Bündel, und ein offener Spider bleibt stehen (LFH-668, D5).
    const nurInhalt = nurInhaltGeaendert(markerDatenRef.current, marker);
    markerDatenRef.current = marker;
    einsatzortDatenRef.current = einsatzort;
    // Registry für styleimagemissing (Key → Zeichenquelle). `markerIconKey` ist die eine Quelle der
    // Key-Bildung, identisch zum icon-Property aus `baueMarkerFc`.
    zeichenRegistryRef.current = baueZeichenRegistry(markers);
    // Cluster-Zusammensetzung kann sich geändert haben → DOM-Donuts verwerfen; ein
    // wiederverwendeter `cluster_id` zeigte sonst veraltete Segmente. Der Donut des offenen
    // Spiders entsteht im `render`-Abgleich neu, mit durchlässiger Hülle.
    const verwirfDonuts = () => {
      for (const id in clusterDomOnScreenRef.current) clusterDomOnScreenRef.current[id].remove();
      clusterDomOnScreenRef.current = {};
      clusterDomRef.current = {};
    };
    wendeKartenDatenAn(map, () => {
      // Verglichen wird mit dem EINGESPIELTEN Stand: wurde vertagt, kann der Spider im Fenster
      // dazwischen auf dem alten Stand aufgegangen sein.
      const nurInhaltAngewandt = nurInhaltGeaendert(
        markerAngewandtRef.current,
        markerDatenRef.current,
      );
      markerAngewandtRef.current = markerDatenRef.current;
      reAnlegenMarker(map, markerDatenRef.current, einsatzortDatenRef.current);
      // Auch hier: bis zum vertagten `setData` hat der `render`-Abgleich die Donuts aus dem alten
      // Quellstand neu gebaut.
      verwirfDonuts();
      const spider = spiderDatenRef.current;
      if (!nurInhaltAngewandt) schliesseSpiderRef.current?.();
      else if (spider) {
        const leaves = aktualisiereSpiderBlaetter(spider.leaves, markerDatenRef.current);
        spiderDatenRef.current = { leaves, legs: spider.legs };
        setzeSpiderDaten(map, leaves, spider.legs);
      }
    });
    verwirfDonuts();
    // Ändern sich Menge, Folge oder Lage, hielte ein offener Spider einen veralteten
    // `getClusterLeaves`-Stand → einklappen. Ein reiner Inhaltswechsel klappt nichts zu.
    if (!nurInhalt) schliesseSpiderRef.current?.();
  }, [markers, markerPlakette]);

  // Eigenposition nachführen. Nach dem Marker-Effekt registriert, damit sie über den Markern liegt.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    eigenpositionRef.current = {
      daten: eigenpositionFc(eigenposition ?? null),
      farbe: rollen.bedien,
    };
    wendeKartenDatenAn(map, () =>
      sorgeFuerEigenpositionLayer(
        map,
        eigenpositionRef.current.daten,
        eigenpositionRef.current.farbe,
      ),
    );
  }, [eigenposition, rollen.bedien]);

  // Einzel-Marker-Klick → Inspector (schluessel) + Cursor. Cluster-Klick läuft über die
  // DOM-Donut-Marker (eigener Effekt unten).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    // Ein Handler über alle Klickebenen: je Ebene feuerte ein Tipp auf Kreis, Kurzzeichen und
    // Trefferzone `onMarkerKlick` bis zu dreimal, womöglich mit verschiedenen Schlüsseln. Gewählt
    // wird, wenn der Tipp einem Marker gehört (`klickzielAm`) — nicht, wenn ein Personen-Cluster,
    // ein Fachebenen-Punkt oder -Bündel am Punkt gezeichnet ist und nur die Trefferzone träfe.
    const klickMarker = (e: maplibregl.MapLayerMouseEvent) => {
      const ziel = klickzielAm(map, e);
      if (ziel?.art !== 'marker') return;
      const schluessel = ziel.merkmal.properties?.schluessel;
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

  // Cluster als DOM-Donut-Marker: bei jedem render die sichtbaren Cluster aus der Source lesen und
  // HTML-Donuts erzeugen/wiederverwenden/entfernen. Der Donut zeigt die Typ-Zusammensetzung mit
  // Schatten (was ein WebGL-circle nicht kann).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const aktualisiere = () => {
      // Solange Kacheln nachladen, bleiben die stehenden Donuts — sonst flackerten sie bei jedem
      // Zoom.
      // Nach `setStyle` fehlt die Quelle, bis die Neuanlage läuft; `isSourceLoaded` würfe dann, und
      // MapLibre meldete das als `error` ohne `tile` — im Abstufungsfenster eine falsche Abstufung.
      if (!map.getSource(MARKER_CLUSTER_QUELLE) || !map.isSourceLoaded(MARKER_CLUSTER_QUELLE))
        return;
      const neu: Record<string, maplibregl.Marker> = {};
      for (const f of map.querySourceFeatures(MARKER_CLUSTER_QUELLE)) {
        const props = f.properties as Record<string, unknown>;
        if (!props.cluster) continue;
        const clusterId = Number(props.cluster_id);
        // Derselbe Schlüssel wie der offene Spider (`spiderOffenRef`).
        const id = clusterSchluessel(MARKER_CLUSTER_QUELLE, clusterId);
        if (neu[id]) continue; // querySourceFeatures kann denselben Cluster über mehrere Tiles liefern
        let marker = clusterDomRef.current[id];
        if (!marker) {
          const coords = (f.geometry as GeoJSON.Point).coordinates as [number, number];
          const el = baueClusterDonut(props);
          el.addEventListener('click', (ev) => {
            ev.stopPropagation();
            // Donut-Klick fächert auf (bei Großclustern Rückfall auf Reinzoomen).
            // `stopPropagation`, damit der allgemeine map-click nicht einklappt.
            oeffneSpiderRef.current?.(
              MARKER_CLUSTER_QUELLE,
              clusterId,
              coords,
              Number(props.point_count ?? 0),
            );
          });
          marker = new maplibregl.Marker({ element: el }).setLngLat(coords);
          clusterDomRef.current[id] = marker;
          // Neu gebaut, während sein Spider offen steht (reine Inhaltsänderung, LFH-668): die
          // Hülle sofort durchlässig, sonst finge sie im Handschuh-Modus den Tipp auf die Blätter.
          if (spiderOffenRef.current === id) setzeHuelleDurchlaessig(el, true);
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

  // Spider-Controller: Donut-Klick fächert die Leaves auf und klappt zuverlässig wieder ein.
  // Setup-once, Map über Ref. Einklappen bei Karten-Move/Zoom, leerem Klick, ESC, erneutem oder
  // anderem Cluster-Klick; Daten- und Style-Wechsel rufen `schliesse()` über `schliesseSpiderRef`.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const leer = { type: 'FeatureCollection' as const, features: [] };

    // Gemeldet wird nur ein Wechsel; ein A→B-Wechsel ist für den Zuhörer kein Zuklappen.
    let gemeldet = false;
    const melde = (offen: boolean) => {
      if (gemeldet === offen) return;
      gemeldet = offen;
      onSpiderOffenRef.current?.(offen);
    };

    const klappeEin = () => {
      spiderTokenRef.current++; // in-flight getClusterLeaves entwerten (load-bearing)
      if (spiderOffenRef.current === null) return;
      setzeHuelleDurchlaessig(clusterDomRef.current[spiderOffenRef.current]?.getElement(), false);
      spiderOffenRef.current = null;
      spiderDatenRef.current = null;
      // `mapRef` wird im Map-Cleanup zuerst genullt → beim Unmount mit offenem Spider ist die Map
      // schon weg, und `getSource` würfe. Der Token-Bump läuft trotzdem.
      if (mapRef.current) setzeSpiderDaten(map, leer, leer);
    };
    const schliesse = () => {
      klappeEin();
      melde(false);
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
      klappeEin(); // A→B: A einklappen, ohne Zwischen-Meldung
      // Die Quelle des geklickten Donuts fragen: ein Personen-Cluster kennt `marker-cluster` nicht.
      // Die Spider-Quellen sind gemeinsam — offen ist höchstens einer.
      const src = map.getSource(quelle) as GeoJSONSource | undefined;
      if (!src) {
        melde(false);
        return;
      }
      // Großcluster → Fallback: reinzoomen (verkleinert Cluster, dann erneut auffächerbar).
      if (anzahl > SPIDER_CAP) {
        melde(false);
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
          // Die Blätter kommen aus dem Worker-Stand der Quelle; kam inzwischen eine reine
          // Inhaltsänderung (die den Token nicht erhöht), gilt der neuere Inhalt (Review LFH-668).
          const { leaves: roh, legs } = baueSpiderFc(props, center, projektor);
          const leafFc = aktualisiereSpiderBlaetter(roh, markerDatenRef.current);
          setzeSpiderDaten(map, leafFc, legs);
          spiderOffenRef.current = schluessel;
          spiderDatenRef.current = { leaves: leafFc, legs };
          setzeHuelleDurchlaessig(clusterDomRef.current[schluessel]?.getElement(), true);
          melde(true);
        })
        .catch(() => {
          // Cluster nach Daten-Update weg → nichts offen. Ein neuerer Auftrag meldet selbst.
          if (token === spiderTokenRef.current) melde(false);
        });
    };

    oeffneSpiderRef.current = oeffne;
    schliesseSpiderRef.current = schliesse;

    const aufKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') schliesse();
    };
    // Karten-Klick: ein Personen-Cluster (WebGL-Layer) fächert auf, wenn der Tipp ihm gehört
    // (`klickzielAm`). Jeder andere Klick klappt ein.
    const klick = (e: maplibregl.MapMouseEvent) => {
      const ziel = klickzielAm(map, e);
      if (ziel?.art === 'personenCluster')
        oeffne(PERSONEN_CLUSTER_QUELLE, ziel.clusterId, ziel.center, ziel.anzahl);
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

  // Viewport nach Kartenbewegung melden: Zoom immer, bbox erst ab `BBOX_MIN_ZOOM` — das Gate
  // schützt Energie (fragt `power=plant` live bei Overpass an) vor einer weltweiten Anfrage.

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

    verarbeite(); // initial (z. B. wenn eine bbox-Ebene bei passendem Zoom aktiviert wird)
    map.on('moveend', melde);
    return () => {
      if (timer) clearTimeout(timer);
      map.off('moveend', melde);
    };
  }, [onBboxAenderung, onZoomAenderung]);

  // Klick auf ein Fachebenen-Objekt → Properties + Quelle nach oben (Detail-Panel). Gebündelte
  // Ebenen (KRITIS): ein Bündel oder Server-Sammelpunkt zoomt hinein — entscheidet
  // `entscheideFachebeneKlick`.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    // Kreis und Trefferzone (LFH-600) liegen ineinander: wer den Kreis nach außen verlässt, steht
    // noch in der Zone. Der Zeiger folgt deshalb der Menge der berührten Ebenen, nicht dem letzten
    // `mouseleave`.
    const beruehrt = new Set<string>();
    const binds = (fachebenen ?? [])
      .flatMap((fe) => fachebeneClickLayerIds(fe.def).map((id) => ({ id, fe })))
      .map(({ id, fe }) => {
        const quelle = fe.def.key;
        const klick = (e: maplibregl.MapLayerMouseEvent) => {
          // Nur der Gewinner des Tipps handelt (`klickzielAm`): im Ring eines Markers zoomt ein
          // Bündel hinein, ohne dass der Marker daneben zusätzlich gewählt wird.
          const gewinner = klickzielAm(map, e);
          if (gewinner?.art !== 'fachebene' || gewinner.merkmal.layer.id !== id) return;
          const feature = gewinner.merkmal;
          const props = (feature?.properties ?? {}) as Record<string, unknown>;
          // Nur gebündelte Ebenen kennen Bündel und Sammelpunkte.
          const ziel: FachebeneKlickZiel = fe.def.buendeln
            ? entscheideFachebeneKlick(props)
            : { art: 'einzel' };
          if (ziel.art !== 'einzel') {
            // Mittelpunkt aus dem Feature, nicht aus dem Klickort — sonst zöge das Hineinzoomen den
            // Bündelrand in die Bildmitte.
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
          // Properties und volle Geometrie aus demselben Feature (siehe `werteFachebenenKlickAus`).
          const aus = werteFachebenenKlickAus(
            feature,
            { lng: e.lngLat.lng, lat: e.lngLat.lat },
            fe.daten,
          );
          onFachebeneKlick?.(aus.props, quelle, aus.geometrie);
        };
        const enter = () => {
          beruehrt.add(id);
          map.getCanvas().style.cursor = 'pointer';
        };
        const leave = () => {
          beruehrt.delete(id);
          if (beruehrt.size === 0) map.getCanvas().style.cursor = '';
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
          (stand) => onZeichnenStandAenderungRef.current?.(stand),
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
          (stand) => onZeichnenStandAenderungRef.current?.(stand),
          'td-zone',
        );
      }
      zoneDrawRef.current.starten(zoneZeichnen);
    } else if (zoneDrawRef.current) {
      zoneDrawRef.current.stoppen();
    }
    // `zoneZeichnenNonce` wird nicht gelesen — sie erzwingt ein Re-Fire bei gleichem Modus, damit
    // `starten()` einen offenen Entwurf verwirft.
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
  const onGriffStandRef = useRef(onGriffStand);
  onGriffStandRef.current = onGriffStand;

  // Bild-Manipulationsgriffe (Ecken/Drehen/Verschieben) im Platzier-Modus.
  const handlesRef = useRef<BildHandles | null>(null);
  // Modus und Maße gehen über Refs in die Erzeugung: als Deps zerstörten sie die Griffe bei jedem
  // Umschalten. Einen Wechsel mitten in einer Ziehgeste stellt `bildHandles` bis `dragend` zurück;
  // die Maße gelten ab dem nächsten Platzieren.
  const griffModusRef = useRef<GriffModus>(griffModus ?? 'groesse');
  const griffKontextRef = useRef<GriffKontext>({
    controlHeight: token.controlHeight,
    bedien: rollen.bedien,
  });
  griffKontextRef.current = { controlHeight: token.controlHeight, bedien: rollen.bedien };

  // Griffe nur an der Bild-ID erzeugen/zerstören, damit Ecken-Änderungen (Eingabe, Refetch) keine
  // laufende Ziehgeste unterbrechen. Live-Vorschau + PATCH bei dragend kapselt `bildHandles`.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !platzierBild) {
      handlesRef.current?.zerstoeren();
      handlesRef.current = null;
      return;
    }
    const handles = erzeugeBildHandles(
      map,
      platzierBild.id,
      platzierBild.ecken,
      (ecken) => {
        onPlatzierGeometrieRef.current?.(ecken);
      },
      griffKontextRef.current,
      griffModusRef.current,
      (stand) => onGriffStandRef.current?.(stand),
    );
    handlesRef.current = handles;
    return () => {
      handles.zerstoeren();
      handlesRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platzierBild?.id]);

  // Ein Moduswechsel schaltet die laufende Griffgruppe um, statt sie neu zu bauen.
  useEffect(() => {
    griffModusRef.current = griffModus ?? 'groesse';
    handlesRef.current?.setzeModus(griffModusRef.current);
  }, [griffModus]);

  // Externe Ecken-Änderungen an die Griffe spiegeln; läuft nicht mid-drag.
  useEffect(() => {
    if (platzierBild) handlesRef.current?.setzeEcken(platzierBild.ecken);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platzierBild?.ecken]);

  // Die Hülle ist der Bezugsrahmen des Menü-Ankers: `e.point` zählt ab der Kartenecke.
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div
        ref={containerRef}
        style={{ width: '100%', height: '100%' }}
        data-testid="kartenflaeche"
      />
      <FlaechenwahlMenue
        key={offeneWahl?.nr}
        wahl={
          offeneWahl && {
            x: offeneWahl.x,
            y: offeneWahl.y,
            eintraege: offeneWahl.flaechen.map((f, i) => ({
              schluessel: String(i),
              text: flaechenKennung(f).text,
            })),
          }
        }
        onWaehlen={(schluessel) => {
          const ziel = offeneWahl?.flaechen[Number(schluessel)];
          if (ziel && offeneWahl) waehleFlaeche(ziel, offeneWahl.lngLat);
        }}
        onSchliessen={() => setOffeneWahl(null)}
        fokusZiel={() => mapRef.current?.getCanvas() ?? null}
      />
    </div>
  );
});

export default Kartenflaeche;
