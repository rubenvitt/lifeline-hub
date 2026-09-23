import type {
  Map as MapLibreMap,
  GeoJSONSource,
  CircleLayerSpecification,
  SymbolLayerSpecification,
} from 'maplibre-gl';
import { FREIES_ZEICHEN_ERSATZLABEL, type KarteMarker, type MarkerTyp } from './marker';
import { tzIconKey } from './markerIcons';
import { CLUSTER_TYP_FARBE, clusterTypProperties } from './clusterDonut';
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
/**
 * Eigene geclusterte Quelle der Betroffenen (LFH-648). Personen clustern NUR untereinander:
 * in `marker-cluster` schluckte ein Cluster aus 40 Betroffenen bei MANV-Dichte die
 * Fahrzeuge daneben — genau der Dichte-Schaden, den die Ebene nicht anrichten darf. Ihre
 * Layer liegen unter allen übrigen Markern (`MARKER_LAYER_REIHENFOLGE`).
 */
export const PERSONEN_CLUSTER_QUELLE = 'marker-personen';
/** Alle geclusterten Marker-Quellen (Spider-Controller: die Quelle des geöffneten Clusters). */
export const CLUSTER_QUELLEN = [MARKER_CLUSTER_QUELLE, PERSONEN_CLUSTER_QUELLE] as const;
/**
 * Klickziele der Personen-CLUSTER (LFH-648). Sie sind bewusst WebGL-Layer und kein DOM-Donut
 * wie die Kräfte-Cluster: ein DOM-Marker hängt ÜBER dem Canvas, ein Personen-Donut deckte
 * damit ein Fahrzeugzeichen zu und fing dessen Klick ab (Review-Befund). Als Layer liegen sie
 * in `MARKER_LAYER_REIHENFOLGE` ganz unten. Kein Teil von `MARKER_KLICK_LAYER` — ein Klick
 * darauf fächert auf, er wählt nichts für den Inspector aus.
 */
export const PERSONEN_CLUSTER_KLICK_LAYER = [
  'personen-cluster-kreis',
  'personen-cluster-zahl',
] as const;
export type ClusterQuelle = (typeof CLUSTER_QUELLEN)[number];
/**
 * Schlüssel eines Clusters über alle Quellen: `cluster_id` ist nur JE Quelle eindeutig. Ohne
 * Präfix überschrieben sich zwei Donuts mit derselben id im DOM-Sync gegenseitig.
 */
export function clusterSchluessel(quelle: ClusterQuelle, clusterId: number | string): string {
  return `${quelle}:${clusterId}`;
}
/**
 * Entscheidet einen Karten-Klick für die Personen-Cluster (LFH-648): ist das OBERSTE Feature am
 * Klickpunkt ein Personen-Cluster, wird er aufgefächert. Liegt ein anderes Zeichen darüber, gehört
 * der Klick ihm — genau das ist die Zusicherung „Personen verdecken keine Kräfte". Rein, damit sie
 * ohne WebGL prüfbar ist; `features` kommt von `queryRenderedFeatures` (oben zuerst).
 */
export function personenClusterTreffer(
  features: readonly {
    layer: { id: string };
    properties: Record<string, unknown> | null;
    geometry: { type: string; coordinates?: unknown };
  }[],
): { clusterId: number; center: [number, number]; anzahl: number } | null {
  const oben = features[0];
  if (!oben || !(PERSONEN_CLUSTER_KLICK_LAYER as readonly string[]).includes(oben.layer.id)) {
    return null;
  }
  if (oben.geometry.type !== 'Point') return null;
  const props = oben.properties ?? {};
  return {
    clusterId: Number(props.cluster_id),
    center: oben.geometry.coordinates as [number, number],
    anzahl: Number(props.point_count ?? 0),
  };
}
export const MARKER_EINSATZORT_QUELLE = 'marker-einsatzort';
export const SPIDER_LEAVES_QUELLE = 'spider-leaves';
export const SPIDER_LEGS_QUELLE = 'spider-legs';
// Die Plakette ist Klickziel wie ihr Zeichen: wer den Namen trifft, meint den Marker.
export const MARKER_KLICK_LAYER = [
  'personen-kreis',
  'personen-kurz',
  'personen-label',
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
  // Betroffene (LFH-648) zuunterst: jedes Kräfte-/Objektzeichen liegt über ihnen, auch über
  // ihren Clustern.
  'personen-cluster-kreis',
  'personen-cluster-zahl',
  'personen-kreis',
  'personen-kurz',
  'personen-label',
  'marker-status-ring',
  'marker-kreis',
  'marker-kurz',
  'marker-label',
  'marker-einsatzort-label',
  'marker-symbol',
  'marker-einsatzort-symbol',
  'spider-legs-line',
  'spider-status-ring',
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
 * Teilt die clusterbaren Marker auf ihre Quellen (LFH-648): Personen in `marker-personen`,
 * alles andere in `marker-cluster`. Die EINE Stelle der Zuordnung — die Aufrufer reichen
 * weiter die ganze Menge (`baueMarkerFc`), und keine Konsumentin der Kartenfläche muss
 * wissen, dass es zwei Quellen gibt.
 */
function teileNachQuelle(
  marker: MarkerFeatureCollection,
): Record<ClusterQuelle, MarkerFeatureCollection> {
  const personen: MarkerFeature[] = [];
  const rest: MarkerFeature[] = [];
  for (const f of marker.features) (f.properties.typ === 'person' ? personen : rest).push(f);
  return {
    [MARKER_CLUSTER_QUELLE]: { type: 'FeatureCollection', features: rest },
    [PERSONEN_CLUSTER_QUELLE]: { type: 'FeatureCollection', features: personen },
  };
}

/** Clusterquelle mit den Einstellungen, die beide Marker-Quellen teilen. */
function clusterQuelle(data: MarkerFeatureCollection) {
  // clusterRadius:45 px — moderates Zusammenfassen erst bei echtem Gedränge (dezent, kein
  // aggressives Verschmelzen schon bei lockerer Streuung). clusterMaxZoom:14 — ab Zoom 14
  // wird nicht mehr geclustert (Einzelmarker), passend zur Detailarbeit auf Stadt-/Objektebene.
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
  const geteilt = teileNachQuelle(marker);
  for (const quelle of CLUSTER_QUELLEN) {
    if (!map.getSource(quelle)) map.addSource(quelle, clusterQuelle(geteilt[quelle]));
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
    fehlt('personen-kurz') ||
    fehlt('personen-label') ||
    fehlt('personen-cluster-zahl') ||
    fehlt('spider-label') ||
    fehlt('spider-kurz')
      ? plakettenSchrift(map.getStyle())
      : undefined;
  // Betroffene (LFH-648): Kreis in Sichtungsfarbe, Kürzel darin, Plakette „R-042 · SK II" ab
  // `BESCHRIFTUNG_AB_ZOOM` — dieselbe Optik wie die übrigen Kreis-Marker, nur aus der eigenen
  // Quelle. Kein Symbol- und kein Status-Layer: Personen tragen weder TZ noch FMS-Status.
  // Personen-Cluster: Kreis in der Donut-Farbe der Objektart (`CLUSTER_TYP_FARBE.person`,
  // dieselbe wie das Personen-Segment eines Donuts), gestaffelt nach Menge, mit Zahl.
  if (fehlt('personen-cluster-kreis')) {
    map.addLayer({
      id: 'personen-cluster-kreis',
      type: 'circle',
      source: PERSONEN_CLUSTER_QUELLE,
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': CLUSTER_TYP_FARBE.person,
        'circle-radius': ['step', ['get', 'point_count'], 14, 10, 18, 50, 22],
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
        'text-field': ['get', 'point_count_abbreviated'],
        'text-size': 11,
        ...(schrift ? { 'text-font': schrift } : {}),
        'text-allow-overlap': true,
        'text-ignore-placement': true,
      },
      paint: { 'text-color': '#fff' },
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
  if (!map.getLayer('spider-status-ring')) {
    map.addLayer({
      id: 'spider-status-ring',
      type: 'circle',
      source: SPIDER_LEAVES_QUELLE,
      filter: ['has', 'statusFarbe'],
      paint: { ...STATUS_RING_PAINT },
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
