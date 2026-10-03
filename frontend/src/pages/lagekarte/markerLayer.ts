import type {
  Map as MapLibreMap,
  GeoJSONSource,
  CircleLayerSpecification,
  ExpressionSpecification,
  SymbolLayerSpecification,
} from 'maplibre-gl';
import { FREIES_ZEICHEN_ERSATZLABEL, type KarteMarker, type MarkerTyp } from './marker';
import { markerIconKey } from './markerIcons';
import { SK_DRINGLICHKEIT, clusterTypProperties, skFarbe } from './clusterDonut';
import { SK_KURZZEICHEN } from '../../personen/personenKarte';
import { farbenDunkel } from '../../theme/tokens';
import { plakettenBildId, plakettenSchrift, zonenPlakette, type Plakette } from './plakette';
import { ordneEigenpositionEin } from './eigenpositionLayer';

// Felder, die eine Layer-Expression, ein Filter, der Klick-Handler oder die Cluster-Aggregation
// liest: schluessel (Klick → Inspector), typ (Donut-Segmente), farbe (marker-kreis), icon
// (marker-symbol + Kreis/Symbol-Unterscheidung), statusFarbe (marker-status-ring),
// beschriftung/plakette/textFarbe/rang (Plaketten-Layer). `label` fehlt: die Plakette liest
// `beschriftung`, und die fehlt genau dort, wo ein label kein Name ist.
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
  /** Durchmesser der unsichtbaren Trefferzone (`KarteMarker.trefferDurchmesser`). */
  treffer?: number;
  /** Sichtung (`KarteMarker.sichtung`) — Summand der Cluster-Aggregation `s_<kategorie>`. */
  sk?: string;
  /** Eigene Cluster-Quelle (`KarteMarker.clusterQuelle`) — liest `teileNachQuelle`. */
  quelle?: 'personen';
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
 * Vorrang der Plaketten bei Platzmangel: wer führt, vor wem fährt, vor den Orten. Der Einsatzort
 * hat eine eigene Quelle und steht ohnehin über allen.
 */
const PLAKETTEN_RANG: Partial<Record<MarkerTyp, number>> = {
  fuehrung: 0,
  fahrzeug: 1,
  einheit: 2,
  abschnitt: 3,
  uhs: 4,
  betreuungsstelle: 5,
  schaden: 6,
  freies_zeichen: 7,
};

/** Der Name auf der Plakette — oder keiner, wo das label keiner ist. */
function beschriftungVon(mk: KarteMarker): string | undefined {
  if (mk.typ === 'lagemeldung') return undefined; // „Meldung #412": Nummer, kein Name
  if (mk.typ === 'freies_zeichen' && mk.label === FREIES_ZEICHEN_ERSATZLABEL) return undefined;
  const text = mk.label.trim();
  return text === '' ? undefined : text;
}

function toFeature(mk: KarteMarker, plakette: Plakette): MarkerFeature {
  const properties: MarkerProps = { schluessel: mk.schluessel, typ: mk.typ, farbe: mk.farbe };
  const icon = markerIconKey(mk);
  if (icon) properties.icon = icon;
  if (mk.statusFarbe) properties.statusFarbe = mk.statusFarbe;
  if (mk.kurzzeichen) properties.kurzzeichen = mk.kurzzeichen;
  if (mk.trefferDurchmesser) properties.treffer = mk.trefferDurchmesser;
  if (mk.sichtung) properties.sk = mk.sichtung;
  if (mk.clusterQuelle) properties.quelle = mk.clusterQuelle;
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

/**
 * Clusterbare Marker (alle außer dem Einsatzort) als FeatureCollection. `plakette` trägt die
 * aufgelösten Rollen des aktiven Modus; ohne Angabe Nacht.
 */
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
/**
 * Eigene geclusterte Quelle der Betroffenen: Personen clustern nur untereinander — in
 * `marker-cluster` schluckte ein Cluster aus 40 Betroffenen die Fahrzeuge daneben. Ihre Layer
 * liegen unter allen übrigen Markern (`MARKER_LAYER_REIHENFOLGE`).
 */
export const PERSONEN_CLUSTER_QUELLE = 'marker-personen';
/** Alle geclusterten Marker-Quellen (Spider-Controller: die Quelle des geöffneten Clusters). */
export const CLUSTER_QUELLEN = [MARKER_CLUSTER_QUELLE, PERSONEN_CLUSTER_QUELLE] as const;
/**
 * Klickziele der Personen-Cluster. Bewusst WebGL-Layer und kein DOM-Donut: ein DOM-Marker hängt
 * über dem Canvas und fing Klicks auf Fahrzeugzeichen ab. Kein Teil von `MARKER_KLICK_LAYER` — ein
 * Klick fächert auf, er wählt nichts für den Inspector aus. Wem ein Tipp gehört, entscheidet
 * `klickziel.ts` (ein sichtbarer Cluster geht jeder bloßen Trefferzone vor).
 */
export const PERSONEN_CLUSTER_KLICK_LAYER = [
  'personen-cluster-kreis',
  'personen-cluster-zahl',
] as const;
type ClusterQuelle = (typeof CLUSTER_QUELLEN)[number];
/** Schlüssel eines Clusters über alle Quellen: `cluster_id` ist nur je Quelle eindeutig. */
export function clusterSchluessel(quelle: ClusterQuelle, clusterId: number | string): string {
  return `${quelle}:${clusterId}`;
}
export const MARKER_EINSATZORT_QUELLE = 'marker-einsatzort';
export const SPIDER_LEAVES_QUELLE = 'spider-leaves';
export const SPIDER_LEGS_QUELLE = 'spider-legs';
// Die Plakette ist Klickziel wie ihr Zeichen: wer den Namen trifft, meint den Marker.
export const MARKER_KLICK_LAYER = [
  // Einzel-Personen der Lagekarte; ihre Cluster fächern auf (`PERSONEN_CLUSTER_KLICK_LAYER`).
  'personen-treffer',
  'personen-kreis',
  'personen-kurz',
  'personen-label',
  'marker-treffer',
  'marker-einsatzort-treffer',
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

// Cluster sind DOM-Donut-Marker (clusterDonut + Kartenflaeche), kein Layer in dieser Liste. Die
// transienten Spider-Layer liegen ganz oben (Beinchen unter den Leaf-Symbolen). Die Plaketten
// liegen unter den Zeichen: MapLibre vergibt Platz von oben nach unten, die Zeichen (allow-overlap)
// belegen ihn zuerst, und keine Plakette deckt ein Nachbarzeichen zu. Der Einsatzort-Name liegt
// über den übrigen.
const MARKER_LAYER_REIHENFOLGE = [
  // Betroffene zuunterst: jedes Kräfte-/Objektzeichen liegt über ihnen und ihren Clustern.
  'personen-cluster-kante',
  'personen-cluster-kreis',
  'personen-cluster-zahl',
  'personen-treffer',
  'personen-kante',
  'personen-kreis',
  'personen-kurz',
  'personen-label',
  'marker-treffer',
  'marker-einsatzort-treffer',
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

// Geteilte Paint/Layout-Configs für Einzelmarker- und Spider-Leaf-Layer. Die Spider-Source ist
// ungeclustert → dieselben Paints, andere Filter.
const STATUS_RING_PAINT: CircleLayerSpecification['paint'] = {
  'circle-radius': 20,
  'circle-color': ['get', 'statusFarbe'],
  'circle-opacity': 0.9,
};
/**
 * Unsichtbare Trefferzone: ein Kreis mit dem Durchmesser aus `treffer`, ohne Füllung und Rand,
 * unter allen Markerebenen und Klickziel wie sie — MapLibre prüft die Geometrie, nicht die
 * Deckkraft (`e2e/gate3-trefflaeche.spec.ts`). Bei Überlappung wählt der Klick-Handler das
 * nächstgelegene Merkmal ({@link naechstesMerkmal}). Jeder Marker-Builder der Lagekarte setzt
 * `treffer`; die dunkle Außenkante ({@link KANTE_PAINT}) bleibt den Personen vorbehalten.
 */
const TREFFER_PAINT: CircleLayerSpecification['paint'] = {
  'circle-radius': ['/', ['get', 'treffer'], 2],
  'circle-opacity': 0,
  'circle-stroke-width': 0,
};
/**
 * Dunkle Außenkante der Personen-Marker: 2 px Schwarz außerhalb des weißen Rands von {@link
 * KREIS_PAINT} (der Rand endet bei 9 + 2 = 11 px). Zwei, nicht anderthalb Pixel: bei 1,5 px zerfiel
 * die Kante bei DPR 1 in Kantenglättung. Weiß und Schwarz nebeneinander halten gegen jeden Grund ≥
 * 3 : 1 (WCAG 1.4.11): max(K(weiß, g), K(schwarz, g)) ≥ √21 ≈ 4,58. Nur für Features mit `sk`.
 *
 * Bewusst `'#000'` und nicht `sichtungsfarben.schwarz`: die Kante ist eine Kontur, keine
 * Sichtungsaussage — aus der Sichtungsachse gelesen sähe sie wie eine Bindung an „Tote" aus.
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
 * Kurzzeichen im Kreis (Betroffenen-Karte): die Sichtung als Kürzel („II") in der Markerfläche —
 * der zweite Kanal neben der Farbe, der anders als die Plakette weder am Mindestzoom hängt noch
 * einer Kollision weicht. Schwarz mit weißem Hof liest sich auf allen Sichtungsfarben.
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
 * Ab dieser Zoomstufe tragen Marker ihre Namensplakette. Darunter ist die Karte Übersicht (die
 * Cluster fassen bis Zoom 14 zusammen). Der aufgefächerte Spider ist ausgenommen.
 */
export const BESCHRIFTUNG_AB_ZOOM = 12;

/**
 * Plakette neben dem Zeichen: 9-Slice-Bild (`plakette.ts`) per `icon-text-fit` um den Namen.
 * Kollision bleibt an — anders als ein Zeichen darf eine Plakette weichen; vorher probiert sie die
 * vier Seiten (`text-variable-anchor`). 3 em Abstand setzen sie neben das auf ≤ 34 px normierte
 * Zeichen. Die Schrift wählt `plakettenSchrift` nach dem Glyphen-Server des aktiven Stils.
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
 * Teilt die clusterbaren Marker auf ihre Quellen: `clusterQuelle: 'personen'` (Betroffene der
 * Lagekarte) nach `marker-personen`, alles andere nach `marker-cluster`. Datengetrieben statt über
 * einen Kartenschalter — die Betroffenen-Karte setzt das Feld nicht, und `kartenLayer.ts` muss nach
 * einem Stilwechsel nichts wissen. Die eine Stelle der Zuordnung.
 */
function teileNachQuelle(
  marker: MarkerFeatureCollection,
): Record<ClusterQuelle, MarkerFeatureCollection> {
  const personen: MarkerFeature[] = [];
  const rest: MarkerFeature[] = [];
  for (const f of marker.features) (f.properties.quelle === 'personen' ? personen : rest).push(f);
  return {
    [MARKER_CLUSTER_QUELLE]: { type: 'FeatureCollection', features: rest },
    [PERSONEN_CLUSTER_QUELLE]: { type: 'FeatureCollection', features: personen },
  };
}

/** Kreisradius eines Personen-Clusters nach Menge, plus `zuschlag` (für die Außenkante). */
function clusterRadius(zuschlag: number): ExpressionSpecification {
  return ['step', ['get', 'point_count'], 14 + zuschlag, 10, 18 + zuschlag, 50, 22 + zuschlag];
}

/**
 * MapLibre-Ausdruck „Wert der dringlichsten Sichtung im Cluster": die erste Kategorie aus
 * `SK_DRINGLICHKEIT`, deren Zähler `s_<kategorie>` positiv ist.
 */
function nachDringlichkeit(
  wert: (k: (typeof SK_DRINGLICHKEIT)[number]) => string,
): ExpressionSpecification {
  const zweige: unknown[] = [];
  for (const k of SK_DRINGLICHKEIT.slice(0, -1)) {
    zweige.push(['>', ['get', `s_${k}`], 0], wert(k));
  }
  return [
    'case',
    ...zweige,
    wert(SK_DRINGLICHKEIT[SK_DRINGLICHKEIT.length - 1]),
  ] as ExpressionSpecification;
}

/** Clusterquelle mit den Einstellungen, die beide Marker-Quellen teilen. */
function clusterQuelle(data: MarkerFeatureCollection) {
  // clusterRadius 45 px: zusammengefasst wird erst bei echtem Gedränge. clusterMaxZoom 14: darüber
  // Einzelmarker für die Detailarbeit.
  return {
    type: 'geojson' as const,
    data: data as never,
    cluster: true,
    clusterRadius: 45,
    clusterMaxZoom: 14,
    // per-Typ-Counts am Cluster-Feature → speisen die Donut-Segmente (clusterDonut).
    clusterProperties: clusterTypProperties() as never,
  };
}

/**
 * Idempotent: Sources (Cluster + ungeclusterter Einsatzort) und circle/symbol-Layer. Nach einem
 * Style-Wechsel erneut aufrufen. Mal-Reihenfolge von unten: Status-Ring, Kreis (Lagemeldung),
 * TZ-Symbol, Einsatzort-Symbol. Cluster sind DOM-Donut-Marker.
 */
export function sorgeFuerMarkerLayer(
  map: MapLibreMap,
  marker: MarkerFeatureCollection,
  einsatzort: MarkerFeatureCollection,
) {
  const geteilt = teileNachQuelle(marker);
  for (const quelle of CLUSTER_QUELLEN) {
    if (!map.getSource(quelle)) map.addSource(quelle, clusterQuelle(geteilt[quelle]));
  }
  if (!map.getSource(MARKER_EINSATZORT_QUELLE)) {
    map.addSource(MARKER_EINSATZORT_QUELLE, { type: 'geojson', data: einsatzort as never });
  }
  // FMS-Status-Ring (nur Fahrzeuge mit Status): ein Kreis hinter dem Symbol, der über dessen Rand
  // hinausragt. radius 20 (40 px) > die in Kartenflaeche auf ≤ 34 px normierte Symbolgröße; nur
  // Fahrzeuge tragen `statusFarbe`, ein fester Radius genügt.
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
  // Lagemeldung (kein TZ) — einfacher Kreis, farbig mit weißem Rand.
  if (!map.getLayer('marker-kreis')) {
    map.addLayer({
      id: 'marker-kreis',
      type: 'circle',
      source: MARKER_CLUSTER_QUELLE,
      filter: ['all', ['!', ['has', 'point_count']], ['!', ['has', 'icon']]],
      paint: { ...KREIS_PAINT },
    });
  }
  // Zeichen-Marker — Symbol mit lazy über den Bild-Resolver (`kartenbildResolver.ts`) angelegtem Icon.
  if (!map.getLayer('marker-symbol')) {
    map.addLayer({
      id: 'marker-symbol',
      type: 'symbol',
      source: MARKER_CLUSTER_QUELLE,
      filter: ['all', ['!', ['has', 'point_count']], ['has', 'icon']],
      layout: { ...SYMBOL_LAYOUT },
    });
  }
  // Cluster-Bubbles sind DOM-Donut-Marker, kein Layer (weiche Schatten + Typ-Zusammensetzung kann
  // WebGL-circle nicht). Der Einsatzort (eigene, ungeclusterte Source) ist immer als Einzelsymbol
  // sichtbar und hat eine eigene Trefferzone — `marker-treffer` sieht ihn nicht.
  if (!map.getLayer('marker-einsatzort-treffer')) {
    map.addLayer({
      id: 'marker-einsatzort-treffer',
      type: 'circle',
      source: MARKER_EINSATZORT_QUELLE,
      filter: ['has', 'treffer'],
      paint: { ...TREFFER_PAINT },
    });
  }
  if (!map.getLayer('marker-einsatzort-symbol')) {
    map.addLayer({
      id: 'marker-einsatzort-symbol',
      type: 'symbol',
      source: MARKER_EINSATZORT_QUELLE,
      layout: { ...SYMBOL_LAYOUT },
    });
  }
  // Namensplaketten. Die Schrift nur lesen, wenn ein Layer fehlt — `getStyle` serialisiert den
  // ganzen Stil.
  const fehlt = (id: string) => !map.getLayer(id);
  const schrift =
    fehlt('marker-label') ||
    fehlt('marker-einsatzort-label') ||
    fehlt('marker-kurz') ||
    fehlt('personen-kurz') ||
    fehlt('personen-label') ||
    fehlt('personen-cluster-zahl') ||
    fehlt('spider-label') ||
    fehlt('spider-kurz')
      ? plakettenSchrift(map.getStyle())
      : undefined;
  // Betroffene: Kreis in Sichtungsfarbe, Kürzel darin, Plakette ab `BESCHRIFTUNG_AB_ZOOM` — aus der
  // eigenen Quelle, ohne Symbol- und Status-Layer. Personen-Cluster: Kreis in der Farbe der
  // dringlichsten Sichtung (Aggregation `s_<kategorie>`), darin Zahl und Kürzel — die Kategorie nie
  // allein über die Farbe. Weißer Rand plus schwarze Außenkante wie am Einzelmarker.
  if (fehlt('personen-cluster-kante')) {
    map.addLayer({
      id: 'personen-cluster-kante',
      type: 'circle',
      source: PERSONEN_CLUSTER_QUELLE,
      filter: ['has', 'point_count'],
      paint: { 'circle-color': '#000', 'circle-radius': clusterRadius(4) },
    });
  }
  if (fehlt('personen-cluster-kreis')) {
    map.addLayer({
      id: 'personen-cluster-kreis',
      type: 'circle',
      source: PERSONEN_CLUSTER_QUELLE,
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': nachDringlichkeit(skFarbe),
        'circle-radius': clusterRadius(0),
        'circle-stroke-color': '#fff',
        'circle-stroke-width': 2,
      },
    });
  }
  if (fehlt('personen-cluster-zahl')) {
    map.addLayer({
      id: 'personen-cluster-zahl',
      type: 'symbol',
      source: PERSONEN_CLUSTER_QUELLE,
      filter: ['has', 'point_count'],
      layout: {
        'text-field': [
          'format',
          ['get', 'point_count_abbreviated'],
          {},
          '\n',
          {},
          nachDringlichkeit((k) => SK_KURZZEICHEN[k]),
          { 'font-scale': 0.8 },
        ],
        'text-size': 11,
        ...(schrift ? { 'text-font': schrift } : {}),
        'text-allow-overlap': true,
        'text-ignore-placement': true,
      },
      paint: { ...KURZ_PAINT },
    });
  }
  // Trefferzone und Außenkante der Einzel-Personen wie in `marker-cluster`; die Personen tragen
  // `treffer`/`sk` aus `personenMarker`.
  if (fehlt('personen-treffer')) {
    map.addLayer({
      id: 'personen-treffer',
      type: 'circle',
      source: PERSONEN_CLUSTER_QUELLE,
      filter: ['all', ['!', ['has', 'point_count']], ['has', 'treffer']],
      paint: { ...TREFFER_PAINT },
    });
  }
  if (fehlt('personen-kante')) {
    map.addLayer({
      id: 'personen-kante',
      type: 'circle',
      source: PERSONEN_CLUSTER_QUELLE,
      filter: ['all', ['!', ['has', 'point_count']], ['has', 'sk']],
      paint: { ...KANTE_PAINT },
    });
  }
  if (fehlt('personen-kreis')) {
    map.addLayer({
      id: 'personen-kreis',
      type: 'circle',
      source: PERSONEN_CLUSTER_QUELLE,
      filter: ['!', ['has', 'point_count']],
      paint: { ...KREIS_PAINT },
    });
  }
  if (fehlt('personen-kurz')) {
    map.addLayer({
      id: 'personen-kurz',
      type: 'symbol',
      source: PERSONEN_CLUSTER_QUELLE,
      filter: ['all', ['!', ['has', 'point_count']], ['has', 'kurzzeichen']],
      layout: kurzLayout(schrift),
      paint: { ...KURZ_PAINT },
    });
  }
  if (fehlt('personen-label')) {
    map.addLayer({
      id: 'personen-label',
      type: 'symbol',
      source: PERSONEN_CLUSTER_QUELLE,
      minzoom: BESCHRIFTUNG_AB_ZOOM,
      filter: ['all', ['!', ['has', 'point_count']], ['has', 'beschriftung']],
      layout: plakettenLayout(schrift),
      paint: { ...PLAKETTEN_PAINT },
    });
  }
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
 * Idempotent: zwei ungeclusterte Sources (Leaves + Beinchen) und ihre Layer für das Auffächern. Die
 * Daten setzt der Controller in Kartenflaeche (`setzeSpiderDaten`). Beinchen zuerst, also unter den
 * Leaf-Symbolen; die Leaf-Layer spiegeln die Einzelmarker-Optik.
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
  // Ohne Mindestzoom: aufgefächert wird, um zu unterscheiden. Mit Kollision wie überall.
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
 * Hält die Marker-Layer über allen anderen Daten-Layern: moveLayer ohne beforeId schiebt ans Ende,
 * die Reihenfolge erhält die Mal-Reihenfolge.
 *
 * Muss nach jeder dynamischen Layer-Anlage einer anderen Ebene erneut laufen — jene landen sonst
 * über den Markern und fangen deren Klicks ab. Beim Mount macht das Pinnen die Reihenfolge
 * unabhängig vom Rennen der Render-Poller. Die Eigenposition bleibt darüber (LFH-766).
 */
export function pinneMarkerLayerNachOben(map: MapLibreMap) {
  for (const id of MARKER_LAYER_REIHENFOLGE) {
    if (map.getLayer(id)) map.moveLayer(id);
  }
  ordneEigenpositionEin(map);
}

/** Marker-Sources + Layer idempotent anlegen UND die aktuellen Daten einspielen (setData). */
export function reAnlegenMarker(
  map: MapLibreMap,
  marker: MarkerFeatureCollection,
  einsatzort: MarkerFeatureCollection,
) {
  sorgeFuerMarkerLayer(map, marker, einsatzort);
  const geteilt = teileNachQuelle(marker);
  for (const quelle of CLUSTER_QUELLEN) {
    (map.getSource(quelle) as GeoJSONSource | undefined)?.setData(geteilt[quelle] as never);
  }
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

/**
 * Das Merkmal, das einem Klickpunkt am nächsten liegt. Mit den Trefferzonen überlappen die
 * Klickflächen benachbarter Marker (Zone 48/72 px, Spider-Abstand 40 px); MapLibre liefert die
 * Treffer in Zeichenreihenfolge, nicht nach Abstand. Rein; `projiziere` ist `map.project`.
 */
export function naechstesMerkmal<F extends { geometry?: { type: string; coordinates?: unknown } }>(
  merkmale: readonly F[],
  punkt: { x: number; y: number },
  projiziere: (lngLat: [number, number]) => { x: number; y: number },
): F | undefined {
  let bestes: F | undefined;
  let abstand = Number.POSITIVE_INFINITY;
  for (const m of merkmale) {
    if (m.geometry?.type !== 'Point') continue;
    const p = projiziere(m.geometry.coordinates as [number, number]);
    const d = Math.hypot(p.x - punkt.x, p.y - punkt.y);
    if (d < abstand) {
      abstand = d;
      bestes = m;
    }
  }
  return bestes ?? merkmale[0];
}
