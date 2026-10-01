/**
 * Wem ein Tipp auf der Lagekarte gehört (LFH-764): genau einem Ziel. Zonen, Abschnitte, Fachebenen
 * und Marker haben je eigene Klick-Hörer, die parallel feuern; jeder fragt diesen Schiedsrichter und
 * handelt nur als Gewinner. Rangfolge:
 *  1. das oberste GEZEICHNETE Punktziel (Markerzeichen samt Plakette, aufgefächertes Zeichen,
 *     Personen-Cluster, Fachebenen-Punkt oder -Bündel),
 *  2. sonst eine Trefferzone — die eines Markers oder eines Fachebenen-Punkts (LFH-600); das Ziel,
 *     dessen Punkt dem Tipp am nächsten liegt, gewinnt, gleich welcher Art,
 *  3. sonst die Flächen (Zone, Abschnitt, Fachebenen-Fläche): genau eine wird direkt gewählt, zwei
 *     oder mehr verschiedene melden sich als `mehrdeutig` — dann wählt der Mensch im Menü (LFH-812),
 *     denn keine Rangfolge unter übereinanderliegenden Flächen trifft immer, was er meint.
 * Eine Trefferzone steht also jedem gezeichneten Punktziel nach (sonst nähme ihr unsichtbarer Ring
 * einem KRITIS-Bündel oder Pegel daneben den Tipp) und schlägt jede Fläche (Marker liegen fast
 * immer in einer Zone oder einem Abschnitt, die Zone aus LFH-711 wäre sonst dort wirkungslos).
 * Im Menü stehen eigene Flächen vor Fachebenen-Flächen: NINA-/DWD-Warnungen liegen über Zonen und
 * decken oft einen Kreis ab (Entscheidung 29.09.2026, LFH-764).
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
  | 'fachebeneTreffer'
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
  // Unsichtbare Trefferzone eines Fachebenen-Punkts oder -Bündels (LFH-600). Die Kantenebenen
  // (`-kante`, `-buendel-kante`) sind Kontur und bleiben ohne Rolle.
  if (/^fachebene-.+-treffer$/.test(layerId)) return 'fachebeneTreffer';
  if (/^fachebene-.+-fill$/.test(layerId)) return 'fachebeneFlaeche';
  return null;
}

const PUNKTZIELE = new Set<Klickebene>(['marker', 'personenCluster', 'fachebene']);
const FLAECHEN = new Set<Klickebene>(['zone', 'abschnitt', 'fachebeneFlaeche']);

export interface Merkmal {
  id?: string | number;
  layer: { id: string };
  properties: Record<string, unknown> | null;
  geometry: { type: string; coordinates?: unknown };
}

/** Eine Fläche am Tipppunkt, wie sie das Auswahlmenü anbietet (LFH-812). */
export type Flaechenziel<F extends Merkmal> =
  { art: 'zone'; merkmal: F } | { art: 'abschnitt'; merkmal: F } | { art: 'fachebene'; merkmal: F };

export type Klickziel<F extends Merkmal> =
  | { art: 'marker'; merkmal: F }
  | { art: 'personenCluster'; clusterId: number; center: [number, number]; anzahl: number }
  | { art: 'fachebene'; merkmal: F }
  | { art: 'zone'; merkmal: F }
  | { art: 'abschnitt'; merkmal: F }
  | { art: 'mehrdeutig'; flaechen: Flaechenziel<F>[] };

/**
 * Wer dieselbe Fläche ist: Die Karte meldet eine Zone über Füllung UND Umriss und ein Polygon an
 * Kachelgrenzen mehrfach. Fachebenen-Merkmale tragen oft keine Feature-id; dann stehen ihre
 * Properties für sie — zwei identisch beschriebene Meldungen wären für den Menschen ohnehin dieselbe
 * Wahl.
 */
function flaechenSchluessel(ebene: Klickebene, merkmal: Merkmal): string {
  if (ebene === 'zone' || ebene === 'abschnitt')
    return `${ebene}:${String(merkmal.properties?.id)}`;
  return merkmal.id != null
    ? `${merkmal.layer.id}#${String(merkmal.id)}`
    : `${merkmal.layer.id}:${JSON.stringify(merkmal.properties ?? {})}`;
}

/** Die verschiedenen Flächen am Punkt: eigene vor Fachebenen, je Gruppe oben zuerst. */
function flaechenAm<F extends Merkmal>(
  eingeordnet: { merkmal: F; ebene: Klickebene }[],
): Flaechenziel<F>[] {
  const gesehen = new Set<string>();
  const eigene: Flaechenziel<F>[] = [];
  const fachebenen: Flaechenziel<F>[] = [];
  for (const { merkmal, ebene } of eingeordnet) {
    if (!FLAECHEN.has(ebene)) continue;
    const schluessel = flaechenSchluessel(ebene, merkmal);
    if (gesehen.has(schluessel)) continue;
    gesehen.add(schluessel);
    if (ebene === 'zone') eigene.push({ art: 'zone', merkmal });
    else if (ebene === 'abschnitt') eigene.push({ art: 'abschnitt', merkmal });
    else fachebenen.push({ art: 'fachebene', merkmal });
  }
  return [...eigene, ...fachebenen];
}

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

  // Marker- und Fachebenen-Zonen gleichrangig: der nächste Punkt gewinnt (LFH-600). Oben im
  // Marker-Zweig zählt eine Fachebenen-Zone bewusst nicht mit — sie käme dort als Marker zurück.
  const zone = naechster(['treffer', 'fachebeneTreffer']);
  if (zone) {
    return ordneKlickebene(zone.layer.id) === 'fachebeneTreffer'
      ? { art: 'fachebene', merkmal: zone }
      : { art: 'marker', merkmal: zone };
  }

  const flaechen = flaechenAm(eingeordnet);
  if (flaechen.length === 0) return null;
  if (flaechen.length === 1) return flaechen[0];
  return { art: 'mehrdeutig', flaechen };
}
