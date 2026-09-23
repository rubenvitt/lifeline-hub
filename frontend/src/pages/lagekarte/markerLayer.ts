import type {
  Map as MapLibreMap,
  GeoJSONSource,
  CircleLayerSpecification,
  SymbolLayerSpecification,
} from 'maplibre-gl';
import { FREIES_ZEICHEN_ERSATZLABEL, type KarteMarker, type MarkerTyp } from './marker';
import { tzIconKey } from './markerIcons';
import { clusterTypProperties } from './clusterDonut';
import { farbenDunkel } from '../../theme/tokens';
import { plakettenBildId, plakettenSchrift, zonenPlakette, type Plakette } from './plakette';

// Felder, die eine Layer-Expression, ein Filter, der Klick-Handler oder die Cluster-Aggregation liest:
// schluessel (Klick→Inspector), typ (clusterProperties → Donut-Segmente), farbe (marker-kreis
// circle-color), icon (marker-symbol icon-image + kreis/symbol-Diskriminierung), statusFarbe
// (marker-status-ring), beschriftung/plakette/textFarbe/rang (Plaketten-Layer, LFH-622).
// `label` selbst bleibt weggelassen: die Plakette liest `beschriftung`, und die fehlt genau
// dort, wo ein label kein Name ist (Lagemeldung, Platzhalter) — ein Filter auf `label` sähe
// den Unterschied nicht.
export interface MarkerProps {
  schluessel: string;
  typ: string;
  farbe: string;
  icon?: string;
  statusFarbe?: string;
  beschriftung?: string;
  /** Bild-Id der Plakette (`plakette.ts`), nur mit `beschriftung`. */
  plakette?: string;
  textFarbe?: string;
  /** Vorrang bei der Platzvergabe: kleiner gewinnt (`symbol-sort-key`). */
  rang?: number;
  /** Kurzzeichen IM Kreis (`KarteMarker.kurzzeichen`), ohne Mindestzoom sichtbar. */
  kurzzeichen?: string;
  /** Durchmesser der unsichtbaren Trefferzone (`KarteMarker.trefferDurchmesser`, LFH-650). */
  treffer?: number;
  /** Sichtung (`KarteMarker.sichtung`) — Summand der Cluster-Aggregation `s_<kategorie>`. */
  sk?: string;
}

export type MarkerFeature = {
  type: 'Feature';
  properties: MarkerProps;
  geometry: { type: 'Point'; coordinates: [number, number] };
};

export type MarkerFeatureCollection = {
  type: 'FeatureCollection';
  features: MarkerFeature[];
};

/**
 * Vorrang der Plaketten, wenn der Platz nicht für alle reicht: wer führt, vor wem fährt,
 * vor den Orten. Der Einsatzort hat eine eigene Quelle und steht ohnehin über allen.
 */
const PLAKETTEN_RANG: Partial<Record<MarkerTyp, number>> = {
  fuehrung: 0,
  fahrzeug: 1,
  einheit: 2,
  abschnitt: 3,
  uhs: 4,
  schaden: 5,
  freies_zeichen: 6,
};

/** Der Name auf der Plakette — oder keiner, wo das label keiner ist (LFH-622). */
function beschriftungVon(mk: KarteMarker): string | undefined {
  if (mk.typ === 'lagemeldung') return undefined; // „Meldung #412": Nummer, kein Name
  if (mk.typ === 'freies_zeichen' && mk.label === FREIES_ZEICHEN_ERSATZLABEL) return undefined;
  const text = mk.label.trim();
  return text === '' ? undefined : text;
}

function toFeature(mk: KarteMarker, plakette: Plakette): MarkerFeature {
  const properties: MarkerProps = { schluessel: mk.schluessel, typ: mk.typ, farbe: mk.farbe };
  if (mk.tz) properties.icon = tzIconKey(mk.tz);
  if (mk.statusFarbe) properties.statusFarbe = mk.statusFarbe;
  if (mk.kurzzeichen) properties.kurzzeichen = mk.kurzzeichen;
  if (mk.trefferDurchmesser) properties.treffer = mk.trefferDurchmesser;
  if (mk.sichtung) properties.sk = mk.sichtung;
  const beschriftung = beschriftungVon(mk);
  if (beschriftung) {
    properties.beschriftung = beschriftung;
    properties.plakette = plakettenBildId(plakette);
    properties.textFarbe = plakette.text;
    properties.rang = PLAKETTEN_RANG[mk.typ] ?? Object.keys(PLAKETTEN_RANG).length;
  }
  return {
    type: 'Feature',
    properties,
    geometry: { type: 'Point', coordinates: [mk.lon, mk.lat] },
  };
}

/** Clusterbare Marker (alle außer dem Einsatzort) als FeatureCollection. `plakette` trägt
 *  die aufgelösten Rollen des aktiven Modus; ohne Angabe Nacht (Vorgabe des Neuentwurfs). */
export function baueMarkerFc(
  markers: KarteMarker[],
  plakette: Plakette = zonenPlakette(farbenDunkel),
): MarkerFeatureCollection {
  return {
    type: 'FeatureCollection',
    features: markers.filter((m) => m.typ !== 'einsatzort').map((m) => toFeature(m, plakette)),
  };
}

/** Der Einsatzort-Marker (0 oder 1 Feature) für die eigene, ungeclusterte Source. */
export function baueEinsatzortFc(
  markers: KarteMarker[],
  plakette: Plakette = zonenPlakette(farbenDunkel),
): MarkerFeatureCollection {
  return {
    type: 'FeatureCollection',
    features: markers.filter((m) => m.typ === 'einsatzort').map((m) => toFeature(m, plakette)),
  };
}

export const MARKER_CLUSTER_QUELLE = 'marker-cluster';
export const MARKER_EINSATZORT_QUELLE = 'marker-einsatzort';
export const SPIDER_LEAVES_QUELLE = 'spider-leaves';
export const SPIDER_LEGS_QUELLE = 'spider-legs';
// Die Plakette ist Klickziel wie ihr Zeichen: wer den Namen trifft, meint den Marker.
export const MARKER_KLICK_LAYER = [
  'marker-treffer',
  'marker-symbol',
  'marker-kreis',
  'marker-kurz',
  'marker-status-ring',
  'marker-einsatzort-symbol',
  'marker-label',
  'marker-einsatzort-label',
] as const;
// Aufgefächerte Spider-Leaves sind klickbar wie Einzelmarker (→ onMarkerKlick).
export const SPIDER_KLICK_LAYER = [
  'spider-treffer',
  'spider-symbol',
  'spider-kreis',
  'spider-kurz',
  'spider-status-ring',
  'spider-label',
] as const;

// Cluster werden als DOM-Donut-Marker gerendert (clusterDonut + Kartenflaeche), NICHT als
// circle/symbol-Layer → kein Cluster-Layer in dieser Liste. Die transienten Spider-Layer liegen
// ganz oben (Beinchen unter den Leaf-Symbolen).
// Die Plaketten liegen UNTER den Zeichen (LFH-622): MapLibre vergibt den Platz von der
// obersten Ebene abwärts. So belegen die Zeichen (allow-overlap) ihren Platz zuerst, und die
// Kollision hält jede Plakette von fremden Zeichen fern — lägen die Plaketten oben, deckten
// sie Nachbarzeichen zu. Der Einsatzort-Name liegt über den übrigen und gewinnt gegen sie.
const MARKER_LAYER_REIHENFOLGE = [
  'marker-treffer',
  'marker-status-ring',
  'marker-kante',
  'marker-kreis',
  'marker-kurz',
  'marker-label',
  'marker-einsatzort-label',
  'marker-symbol',
  'marker-einsatzort-symbol',
  'spider-legs-line',
  'spider-treffer',
  'spider-status-ring',
  'spider-kante',
  'spider-kreis',
  'spider-kurz',
  'spider-label',
  'spider-symbol',
] as const;

// Geteilte Paint/Layout-Configs für Einzelmarker- UND Spider-Leaf-Layer (DRY: identische Optik).
// Die Spider-Source ist ungeclustert → die Spider-Layer nutzen dieselben Paints, aber andere Filter.
const STATUS_RING_PAINT: CircleLayerSpecification['paint'] = {
  'circle-radius': 20,
  'circle-color': ['get', 'statusFarbe'],
  'circle-opacity': 0.9,
};
/**
 * Unsichtbare Trefferzone (LFH-650): ein Kreis mit dem Durchmesser aus der Feature-Eigenschaft
 * `treffer`, ohne Füllung und ohne Rand. Er liegt UNTER allen Markerebenen und ist Klickziel
 * wie sie — MapLibre prüft beim Treffertest die Geometrie, nicht die Deckkraft (gemessen in
 * `e2e/betroffene-karte.spec.ts`: ein Klick mit Versatz neben den gezeichneten Kreis öffnet
 * die Person). Nur Features mit `treffer` erzeugen eine Zone; die Lagekarte setzt keins.
 */
const TREFFER_PAINT: CircleLayerSpecification['paint'] = {
  'circle-radius': ['/', ['get', 'treffer'], 2],
  'circle-opacity': 0,
  'circle-stroke-width': 0,
};
/**
 * Dunkle Außenkante der Personen-Marker (LFH-650): 2 px Schwarz AUSSERHALB des weißen
 * Rands von {@link KREIS_PAINT} (MapLibre zeichnet `circle-stroke` außen, der Rand endet bei
 * 9 + 2 = 11 px). Zwei, nicht anderthalb Pixel: bei 1,5 px zerfiel die Kante bei DPR 1 in
 * Kantenglättung, gemessen 3,60 statt ≥ 17 gegen den hellen Grund. Der weiße Rand allein ist auf heller Grundlage keine Kante — gemessen
 * gegen den Kartengrund `#e8e8e8` (`e2e/betroffene-kontrast.spec.ts`), und SK II gelb füllt
 * dort auch nicht aus. Weiß UND Schwarz nebeneinander halten gegen JEDEN Grund ≥ 3 : 1
 * (WCAG 1.4.11): max(K(weiß, g), K(schwarz, g)) ≥ √21 ≈ 4,58 für jede Farbe g — deshalb
 * trägt die Kante auch auf Grundkarten, die e2e nicht lädt. Dieselbe Hell-Dunkel-Paarung wie
 * das Kurzzeichen (`KURZ_PAINT`). Nur für Features mit `sk`: die Lagekarte bleibt gleich.
 */
const KANTE_PAINT: CircleLayerSpecification['paint'] = {
  'circle-radius': 13,
  'circle-color': '#000',
};
const KREIS_PAINT: CircleLayerSpecification['paint'] = {
  'circle-radius': 9,
  'circle-color': ['get', 'farbe'],
  'circle-stroke-color': '#fff',
  'circle-stroke-width': 2,
};
/**
 * Kurzzeichen im Kreis (LFH-613, Betroffenen-Karte): die Sichtung als Wort-Kürzel („II")
 * IN der Markerfläche — der zweite Kanal neben der Farbe (WCAG 1.4.1), der anders als die
 * Plakette WEDER am Mindestzoom hängt NOCH einer Kollision weicht. Schwarz mit weißem Hof
 * liest sich auf allen Sichtungsfarben (rot/gelb/grün/blau/schwarz) — dieselbe Hell-Dunkel-
 * Paarung wie der weiße Kreisrand von `KREIS_PAINT`.
 */
function kurzLayout(
  schrift: string[] | undefined,
): NonNullable<SymbolLayerSpecification['layout']> {
  return {
    'text-field': ['get', 'kurzzeichen'],
    'text-size': 9,
    ...(schrift ? { 'text-font': schrift } : {}),
    'text-allow-overlap': true,
    'text-ignore-placement': true,
  };
}
const KURZ_PAINT: SymbolLayerSpecification['paint'] = {
  'text-color': '#000',
  'text-halo-color': '#fff',
  'text-halo-width': 1.5,
};
const SYMBOL_LAYOUT: SymbolLayerSpecification['layout'] = {
  'icon-image': ['get', 'icon'],
  'icon-size': 1,
  'icon-allow-overlap': true,
};

/**
 * Ab dieser Zoomstufe tragen Marker ihre Namensplakette (LFH-622). Darunter ist die Karte
 * Übersicht: die Cluster fassen ohnehin bis Zoom 14 zusammen, und einzelne Namen zwischen
 * Donuts lesen sich als Rauschen. Der aufgefächerte Spider ist ausgenommen.
 */
export const BESCHRIFTUNG_AB_ZOOM = 12;

/**
 * Plakette neben dem Zeichen im Entwurfsstil (Neuentwurf S5): 9-Slice-Bild (`plakette.ts`)
 * per `icon-text-fit` um den Namen. Kollision bleibt AN — die umgekehrte Regel der Zeichen,
 * die nie verschwinden dürfen: eine Plakette darf weichen. Vorher probiert sie die vier
 * Seiten ihres Zeichens (`text-variable-anchor`); der Abstand von 3 em (bei 10 px Schrift
 * 30 px) setzt sie neben das auf ≤ 34 px normierte Zeichen plus die Lücke des Entwurfs.
 * Die Schrift wählt `plakettenSchrift` nach dem Glyphen-Server des aktiven Stils.
 */
function plakettenLayout(
  schrift: string[] | undefined,
): NonNullable<SymbolLayerSpecification['layout']> {
  return {
    'text-field': ['get', 'beschriftung'],
    'text-size': 10,
    ...(schrift ? { 'text-font': schrift } : {}),
    'text-variable-anchor': ['left', 'right', 'bottom', 'top'],
    'text-radial-offset': 3,
    'symbol-sort-key': ['get', 'rang'],
    'icon-image': ['get', 'plakette'],
    'icon-text-fit': 'both',
    'icon-text-fit-padding': [3, 6, 3, 6],
  };
}
const PLAKETTEN_PAINT: SymbolLayerSpecification['paint'] = { 'text-color': ['get', 'textFarbe'] };

const leerFc = (): MarkerFeatureCollection => ({ type: 'FeatureCollection', features: [] });

/**
 * Idempotent: Sources (Cluster + ungeclusterter Einsatzort) und circle/symbol-Layer für
 * Marker + Clustering. Style-Wechsel entfernt Sources/Layer → bei der Re-Anlage erneut aufrufen.
 * Layer-Reihenfolge (Mal-Reihenfolge von unten): Status-Ring, Kreis (Lagemeldung), TZ-Symbol,
 * Einsatzort-Symbol. Cluster sind separate DOM-Donut-Marker (clusterDonut), kein Layer.
 */
export function sorgeFuerMarkerLayer(
  map: MapLibreMap,
  marker: MarkerFeatureCollection,
  einsatzort: MarkerFeatureCollection,
) {
  if (!map.getSource(MARKER_CLUSTER_QUELLE)) {
    // clusterRadius:45 px — moderates Zusammenfassen erst bei echtem Gedränge (dezent, kein
    // aggressives Verschmelzen schon bei lockerer Streuung). clusterMaxZoom:14 — ab Zoom 14
    // wird nicht mehr geclustert (Einzelmarker), passend zur Detailarbeit auf Stadt-/Objektebene.
    map.addSource(MARKER_CLUSTER_QUELLE, {
      type: 'geojson',
      data: marker as never,
      cluster: true,
      clusterRadius: 45,
      clusterMaxZoom: 14,
      // per-Typ-Counts am Cluster-Feature → speisen die Donut-Segmente (clusterDonut).
      clusterProperties: clusterTypProperties() as never,
    });
  }
  if (!map.getSource(MARKER_EINSATZORT_QUELLE)) {
    map.addSource(MARKER_EINSATZORT_QUELLE, { type: 'geojson', data: einsatzort as never });
  }
  // FMS-Status-Ring (nur Fahrzeuge mit Status) — Kreis HINTER dem Symbol, der über dessen Rand
  // hinausragt → erscheint als farbiger Ring. radius:20 (=40px Durchmesser) > die in Kartenflaeche
  // auf ≤34px normierte Symbolgröße (ZIEL_PX), analog zum früheren 3px-DOM-Border. statusFarbe
  // tragen ausschließlich Fahrzeuge (konstantes TZ) → ein fester Radius genügt.
  if (!map.getLayer('marker-status-ring')) {
    map.addLayer({
      id: 'marker-status-ring',
      type: 'circle',
      source: MARKER_CLUSTER_QUELLE,
      filter: ['all', ['!', ['has', 'point_count']], ['has', 'statusFarbe']],
      paint: { ...STATUS_RING_PAINT },
    });
  }
  if (!map.getLayer('marker-treffer')) {
    map.addLayer({
      id: 'marker-treffer',
      type: 'circle',
      source: MARKER_CLUSTER_QUELLE,
      filter: ['all', ['!', ['has', 'point_count']], ['has', 'treffer']],
      paint: { ...TREFFER_PAINT },
    });
  }
  if (!map.getLayer('marker-kante')) {
    map.addLayer({
      id: 'marker-kante',
      type: 'circle',
      source: MARKER_CLUSTER_QUELLE,
      filter: ['all', ['!', ['has', 'point_count']], ['has', 'sk']],
      paint: { ...KANTE_PAINT },
    });
  }
  // Lagemeldung (kein TZ) — einfacher Kreis (heutige Optik: farbig, weißer Rand).
  if (!map.getLayer('marker-kreis')) {
    map.addLayer({
      id: 'marker-kreis',
      type: 'circle',
      source: MARKER_CLUSTER_QUELLE,
      filter: ['all', ['!', ['has', 'point_count']], ['!', ['has', 'icon']]],
      paint: { ...KREIS_PAINT },
    });
  }
  // TZ-Marker — Symbol mit lazy via styleimagemissing geladenem Icon.
  if (!map.getLayer('marker-symbol')) {
    map.addLayer({
      id: 'marker-symbol',
      type: 'symbol',
      source: MARKER_CLUSTER_QUELLE,
      filter: ['all', ['!', ['has', 'point_count']], ['has', 'icon']],
      layout: { ...SYMBOL_LAYOUT },
    });
  }
  // Cluster-Bubbles bewusst NICHT als circle/symbol-Layer — sie werden als DOM-Donut-Marker
  // gerendert (clusterDonut + DOM-Sync in Kartenflaeche): weiche Schatten + Typ-Zusammensetzung,
  // was WebGL-circle nicht kann. Die unclustered Einzelpunkte bleiben die Layer oben.
  // Einsatzort (eigene, ungeclusterte Source) — immer als Einzelsymbol sichtbar.
  if (!map.getLayer('marker-einsatzort-symbol')) {
    map.addLayer({
      id: 'marker-einsatzort-symbol',
      type: 'symbol',
      source: MARKER_EINSATZORT_QUELLE,
      layout: { ...SYMBOL_LAYOUT },
    });
  }
  // Namensplaketten (LFH-622). Die Schrift nur lesen, wenn überhaupt ein Layer fehlt —
  // `getStyle` serialisiert den ganzen Stil.
  const fehlt = (id: string) => !map.getLayer(id);
  const schrift =
    fehlt('marker-label') ||
    fehlt('marker-einsatzort-label') ||
    fehlt('marker-kurz') ||
    fehlt('spider-label') ||
    fehlt('spider-kurz')
      ? plakettenSchrift(map.getStyle())
      : undefined;
  if (fehlt('marker-kurz')) {
    map.addLayer({
      id: 'marker-kurz',
      type: 'symbol',
      source: MARKER_CLUSTER_QUELLE,
      filter: ['all', ['!', ['has', 'point_count']], ['has', 'kurzzeichen']],
      layout: kurzLayout(schrift),
      paint: { ...KURZ_PAINT },
    });
  }
  if (fehlt('marker-label')) {
    map.addLayer({
      id: 'marker-label',
      type: 'symbol',
      source: MARKER_CLUSTER_QUELLE,
      minzoom: BESCHRIFTUNG_AB_ZOOM,
      filter: ['all', ['!', ['has', 'point_count']], ['has', 'beschriftung']],
      layout: plakettenLayout(schrift),
      paint: { ...PLAKETTEN_PAINT },
    });
  }
  if (fehlt('marker-einsatzort-label')) {
    map.addLayer({
      id: 'marker-einsatzort-label',
      type: 'symbol',
      source: MARKER_EINSATZORT_QUELLE,
      minzoom: BESCHRIFTUNG_AB_ZOOM,
      filter: ['has', 'beschriftung'],
      layout: plakettenLayout(schrift),
      paint: { ...PLAKETTEN_PAINT },
    });
  }
  sorgeFuerSpiderLayer(map, schrift);
  pinneMarkerLayerNachOben(map);
}

/**
 * Idempotent: zwei ungeclusterte Sources (Leaves + Beinchen) und ihre Layer für das Auffächern
 * (Spiderfy). Die Daten setzt der Controller in Kartenflaeche via setzeSpiderDaten; initial leer.
 * Beinchen (Linien zum Anker) ZUERST → unter den Leaf-Symbolen. Die Leaf-Layer spiegeln die
 * Einzelmarker-Optik (geteilte Paints), Filter ohne point_count (Spider-Source ist ungeclustert).
 */
function sorgeFuerSpiderLayer(map: MapLibreMap, schrift: string[] | undefined) {
  if (!map.getSource(SPIDER_LEAVES_QUELLE)) {
    map.addSource(SPIDER_LEAVES_QUELLE, { type: 'geojson', data: leerFc() as never });
  }
  if (!map.getSource(SPIDER_LEGS_QUELLE)) {
    map.addSource(SPIDER_LEGS_QUELLE, { type: 'geojson', data: leerFc() as never });
  }
  if (!map.getLayer('spider-legs-line')) {
    map.addLayer({
      id: 'spider-legs-line',
      type: 'line',
      source: SPIDER_LEGS_QUELLE,
      paint: { 'line-color': '#64748b', 'line-width': 1.5, 'line-opacity': 0.7 },
    });
  }
  if (!map.getLayer('spider-treffer')) {
    map.addLayer({
      id: 'spider-treffer',
      type: 'circle',
      source: SPIDER_LEAVES_QUELLE,
      filter: ['has', 'treffer'],
      paint: { ...TREFFER_PAINT },
    });
  }
  if (!map.getLayer('spider-status-ring')) {
    map.addLayer({
      id: 'spider-status-ring',
      type: 'circle',
      source: SPIDER_LEAVES_QUELLE,
      filter: ['has', 'statusFarbe'],
      paint: { ...STATUS_RING_PAINT },
    });
  }
  if (!map.getLayer('spider-kante')) {
    map.addLayer({
      id: 'spider-kante',
      type: 'circle',
      source: SPIDER_LEAVES_QUELLE,
      filter: ['has', 'sk'],
      paint: { ...KANTE_PAINT },
    });
  }
  if (!map.getLayer('spider-kreis')) {
    map.addLayer({
      id: 'spider-kreis',
      type: 'circle',
      source: SPIDER_LEAVES_QUELLE,
      filter: ['!', ['has', 'icon']],
      paint: { ...KREIS_PAINT },
    });
  }
  if (!map.getLayer('spider-symbol')) {
    map.addLayer({
      id: 'spider-symbol',
      type: 'symbol',
      source: SPIDER_LEAVES_QUELLE,
      filter: ['has', 'icon'],
      layout: { ...SYMBOL_LAYOUT },
    });
  }
  if (!map.getLayer('spider-kurz')) {
    map.addLayer({
      id: 'spider-kurz',
      type: 'symbol',
      source: SPIDER_LEAVES_QUELLE,
      filter: ['has', 'kurzzeichen'],
      layout: kurzLayout(schrift),
      paint: { ...KURZ_PAINT },
    });
  }
  // Ohne Mindestzoom: aufgefächert wird, um zu unterscheiden — dort ist der Name der Zweck.
  // Mit Kollision wie überall: sich überdeckende Namen unterscheiden nichts.
  if (!map.getLayer('spider-label')) {
    map.addLayer({
      id: 'spider-label',
      type: 'symbol',
      source: SPIDER_LEAVES_QUELLE,
      filter: ['has', 'beschriftung'],
      layout: plakettenLayout(schrift),
      paint: { ...PLAKETTEN_PAINT },
    });
  }
}

/**
 * Hält die Marker-Layer über allen anderen Daten-Layern (Abschnitte/Zonen/Bilder/Fachebenen).
 * moveLayer ohne beforeId schiebt ans Ende (= oben); die Reihenfolge erhält die Mal-Reihenfolge
 * (Status-Ring unten … Einsatzort-Symbol oben).
 *
 * Muss nach JEDER dynamischen Layer-Anlage einer anderen Ebene erneut laufen: jene legen ohne
 * beforeId an und landen sonst über den Markern (verdecken sie + fangen ihre Klicks ab). Beim
 * Mount racet zudem der Marker-render-Poller mit den anderen Daten-Pollern; das Pinnen macht die
 * Reihenfolge unabhängig davon. (DOM-Marker lagen früher immer über dem Canvas.)
 */
export function pinneMarkerLayerNachOben(map: MapLibreMap) {
  for (const id of MARKER_LAYER_REIHENFOLGE) {
    if (map.getLayer(id)) map.moveLayer(id);
  }
}

/** Marker-Sources + Layer idempotent anlegen UND die aktuellen Daten einspielen (setData). */
export function reAnlegenMarker(
  map: MapLibreMap,
  marker: MarkerFeatureCollection,
  einsatzort: MarkerFeatureCollection,
) {
  sorgeFuerMarkerLayer(map, marker, einsatzort);
  (map.getSource(MARKER_CLUSTER_QUELLE) as GeoJSONSource | undefined)?.setData(marker as never);
  (map.getSource(MARKER_EINSATZORT_QUELLE) as GeoJSONSource | undefined)?.setData(
    einsatzort as never,
  );
}

/** Spielt aufgefächerte Leaves + Beinchen in die Spider-Sources (Controller in Kartenflaeche). */
export function setzeSpiderDaten(
  map: MapLibreMap,
  leaves: MarkerFeatureCollection,
  legs: { type: 'FeatureCollection'; features: unknown[] },
) {
  (map.getSource(SPIDER_LEAVES_QUELLE) as GeoJSONSource | undefined)?.setData(leaves as never);
  (map.getSource(SPIDER_LEGS_QUELLE) as GeoJSONSource | undefined)?.setData(legs as never);
}
