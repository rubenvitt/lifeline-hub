/**
 * Wem ein Tipp auf der Lagekarte gehört (LFH-764): genau einem Ziel. Zonen, Abschnitte, Fachebenen
 * und Marker haben je eigene Klick-Hörer, die parallel feuern; jeder fragt diesen Schiedsrichter und
 * handelt nur als Gewinner. Rangfolge:
 *  1. das oberste GEZEICHNETE Punktziel (Markerzeichen samt Plakette, aufgefächertes Zeichen,
 *     Personen-Cluster, Fachebenen-Punkt oder -Bündel),
 *  2. sonst eine Trefferzone — der Marker, dessen Punkt dem Tipp am nächsten liegt,
 *  3. sonst die oberste eigene Fläche (Zone, Abschnitt),
 *  4. sonst die oberste Fachebenen-Fläche.
 * Eine Trefferzone steht also jedem gezeichneten Punktziel nach (sonst nähme ihr unsichtbarer Ring
 * einem KRITIS-Bündel oder Pegel daneben den Tipp) und schlägt jede Fläche (Marker liegen fast
 * immer in einer Zone oder einem Abschnitt, die Zone aus LFH-711 wäre sonst dort wirkungslos).
 * Eigene Flächen gehen Fachebenen-Flächen vor: NINA-/DWD-Warnungen liegen über Zonen und decken oft
 * einen Kreis ab (Entscheidung 29.09.2026). Ein Auswahlmenü für übereinanderliegende Flächen: LFH-812.
 * Rein; `merkmale` kommt von `queryRenderedFeatures` (oben zuerst).
 */
import {
  MARKER_KLICK_LAYER,
  PERSONEN_CLUSTER_KLICK_LAYER,
  SPIDER_KLICK_LAYER,
  naechstesMerkmal,
} from './markerLayer';

/** Die Klickebenen der Zonen: Fläche und beide Linienarten. */
export const ZONEN_KLICK_LAYER = ['zonen-fill', 'zonen-line', 'zonen-line-gestrichelt'] as const;
/** Die Klickebene der Einsatzabschnitte. */
export const ABSCHNITT_KLICK_LAYER = 'abschnitte-fill';

export type Klickebene =
  | 'marker'
  | 'treffer'
  | 'personenCluster'
  | 'fachebene'
  | 'zone'
  | 'abschnitt'
  | 'fachebeneFlaeche';

const MARKER_EBENEN = new Set<string>([...MARKER_KLICK_LAYER, ...SPIDER_KLICK_LAYER]);
const PERSONEN_CLUSTER_EBENEN = new Set<string>(PERSONEN_CLUSTER_KLICK_LAYER);
const ZONEN_EBENEN = new Set<string>(ZONEN_KLICK_LAYER);

/** Welche Rolle eine Klickebene im Schiedsspruch hat; `null` für Ebenen, die nicht mitzählen. */
export function ordneKlickebene(layerId: string): Klickebene | null {
  if (MARKER_EBENEN.has(layerId)) return layerId.endsWith('-treffer') ? 'treffer' : 'marker';
  if (PERSONEN_CLUSTER_EBENEN.has(layerId)) return 'personenCluster';
  if (ZONEN_EBENEN.has(layerId)) return 'zone';
  if (layerId === ABSCHNITT_KLICK_LAYER) return 'abschnitt';
  // Namensschema aus `fachebenenLayer.ts` (`fachebeneClickLayerIds`).
  if (/^fachebene-.+-(circle|buendel)$/.test(layerId)) return 'fachebene';
  if (/^fachebene-.+-fill$/.test(layerId)) return 'fachebeneFlaeche';
  return null;
}

const PUNKTZIELE = new Set<Klickebene>(['marker', 'personenCluster', 'fachebene']);
const EIGENE_FLAECHEN = new Set<Klickebene>(['zone', 'abschnitt']);

interface Merkmal {
  layer: { id: string };
  properties: Record<string, unknown> | null;
  geometry: { type: string; coordinates?: unknown };
}

export type Klickziel<F extends Merkmal> =
  | { art: 'marker'; merkmal: F }
  | { art: 'personenCluster'; clusterId: number; center: [number, number]; anzahl: number }
  | { art: 'fachebene'; merkmal: F }
  | { art: 'zone'; merkmal: F }
  | { art: 'abschnitt'; merkmal: F };

/** Der Gewinner eines Tipps, oder `null`, wenn am Punkt kein Klickziel liegt. */
export function entscheideKlickziel<F extends Merkmal>(
  merkmale: readonly F[],
  punkt: { x: number; y: number },
  projiziere: (lngLat: [number, number]) => { x: number; y: number },
): Klickziel<F> | null {
  const eingeordnet = merkmale.flatMap((merkmal) => {
    const ebene = ordneKlickebene(merkmal.layer.id);
    return ebene ? [{ merkmal, ebene }] : [];
  });
  const naechster = (ebenen: Klickebene[]) =>
    naechstesMerkmal(
      eingeordnet.filter((x) => ebenen.includes(x.ebene)).map((x) => x.merkmal),
      punkt,
      projiziere,
    );

  const oben = eingeordnet.find((x) => PUNKTZIELE.has(x.ebene));
  if (oben?.ebene === 'marker') {
    // Unter den Markern wie bisher das nächstgelegene Merkmal, Zonen eingeschlossen: MapLibre
    // liefert Zeichenreihenfolge, nicht Abstand.
    const m = naechster(['marker', 'treffer']);
    return m ? { art: 'marker', merkmal: m } : null;
  }
  if (oben?.ebene === 'personenCluster') {
    const { geometry, properties } = oben.merkmal;
    if (geometry.type !== 'Point') return null;
    return {
      art: 'personenCluster',
      clusterId: Number(properties?.cluster_id),
      center: geometry.coordinates as [number, number],
      anzahl: Number(properties?.point_count ?? 0),
    };
  }
  if (oben?.ebene === 'fachebene') return { art: 'fachebene', merkmal: oben.merkmal };

  const zone = naechster(['treffer']);
  if (zone) return { art: 'marker', merkmal: zone };

  const eigene = eingeordnet.find((x) => EIGENE_FLAECHEN.has(x.ebene));
  if (eigene?.ebene === 'zone') return { art: 'zone', merkmal: eigene.merkmal };
  if (eigene?.ebene === 'abschnitt') return { art: 'abschnitt', merkmal: eigene.merkmal };

  const fremde = eingeordnet.find((x) => x.ebene === 'fachebeneFlaeche');
  return fremde ? { art: 'fachebene', merkmal: fremde.merkmal } : null;
}
