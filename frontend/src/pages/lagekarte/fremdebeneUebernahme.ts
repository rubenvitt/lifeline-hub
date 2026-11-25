/**
 * Ein Objekt einer Fremdebene als eigene Zeichnung übernehmen (LLH-2129), reine Bausteine.
 * Entwurf: `docs/superpowers/specs/2026-11-25-vzxkonvu-fremdebene-objekt-uebernehmen-design.md`.
 *
 * Fläche → Zone, Linie → Linien-Zone, Punkt → freies Zeichen. Mehrteilige Objekte werden in
 * Einzelobjekte zerlegt; die Geometrie stammt aus den vollen Daten der Ebene, nie aus den
 * gekachelten Merkmalen der Karte.
 */
import { ZONE_LABEL_MAX, ZONE_NOTIZ_MAX } from '../../api/eingabegrenzen';
import { ZONE_TYPEN, type ZoneTypInfo } from './zonenStil';

type Position = number[];
export interface PunktGeometrie {
  type: 'Point';
  coordinates: Position;
}
export interface LinienGeometrie {
  type: 'LineString';
  coordinates: Position[];
}
export interface FlaechenGeometrie {
  type: 'Polygon';
  coordinates: Position[][];
}

export type UebernahmeArt = 'flaeche' | 'linie' | 'punkt';
export type UebernahmeTeil =
  | { art: 'flaeche'; geometrie: FlaechenGeometrie }
  | { art: 'linie'; geometrie: LinienGeometrie }
  | { art: 'punkt'; geometrie: PunktGeometrie };

/** Warum ein Objekt nicht übernommen werden kann. */
export type UebernahmeGrund = 'gemischt' | 'zu_viele' | 'leer';

/** Höchstzahl der Teile eines Objekts; darüber würde ein Klick zu viele Objekte anlegen. */
export const UEBERNAHME_TEILE_MAX = 20;

export const UEBERNAHME_GRUND_TEXT: Record<UebernahmeGrund, string> = {
  gemischt: 'Gemischte Objekte lassen sich nicht übernehmen',
  zu_viele: `Mehr als ${UEBERNAHME_TEILE_MAX} Teile lassen sich nicht übernehmen`,
  leer: 'Das Objekt hat keine Geometrie',
};

interface LoseGeometrie {
  type?: unknown;
  coordinates?: unknown;
  geometries?: unknown;
}

function teileVon(g: LoseGeometrie): UebernahmeTeil[] | null {
  const c = g.coordinates as never;
  switch (g.type) {
    case 'Point':
      return [{ art: 'punkt', geometrie: { type: 'Point', coordinates: c } }];
    case 'MultiPoint':
      return (c as Position[]).map((p) => ({
        art: 'punkt',
        geometrie: { type: 'Point', coordinates: p },
      }));
    case 'LineString':
      return [{ art: 'linie', geometrie: { type: 'LineString', coordinates: c } }];
    case 'MultiLineString':
      return (c as Position[][]).map((l) => ({
        art: 'linie',
        geometrie: { type: 'LineString', coordinates: l },
      }));
    case 'Polygon':
      return [{ art: 'flaeche', geometrie: { type: 'Polygon', coordinates: c } }];
    case 'MultiPolygon':
      return (c as Position[][][]).map((p) => ({
        art: 'flaeche',
        geometrie: { type: 'Polygon', coordinates: p },
      }));
    case 'GeometryCollection': {
      const teile: UebernahmeTeil[] = [];
      for (const kind of (g.geometries as LoseGeometrie[] | undefined) ?? []) {
        const t = teileVon(kind);
        if (!t) return null;
        teile.push(...t);
      }
      return teile;
    }
    default:
      return null;
  }
}

/** Zerlegt eine Geometrie in übernehmbare Teile gleicher Art. */
export function zerlege(
  geometrie: unknown,
): { teile: UebernahmeTeil[] } | { grund: UebernahmeGrund } {
  if (!geometrie || typeof geometrie !== 'object') return { grund: 'leer' };
  const teile = teileVon(geometrie as LoseGeometrie);
  if (!teile || teile.length === 0) return { grund: 'leer' };
  if (new Set(teile.map((t) => t.art)).size > 1) return { grund: 'gemischt' };
  if (teile.length > UEBERNAHME_TEILE_MAX) return { grund: 'zu_viele' };
  return { teile };
}

const ARTEN: Record<'flaeche' | 'linie', ZoneTypInfo['typ'][]> = {
  flaeche: ['gefahrengebiet', 'absperrbereich', 'sperrgebiet', 'freie_skizze'],
  linie: ['absperrgrenze', 'freie_skizze'],
};

/** Zonenarten zur Wahl, die erste ist die Vorgabe. Einzige Quelle bleibt `ZONE_TYPEN`. */
export function zonenArtenFuer(art: 'flaeche' | 'linie'): ZoneTypInfo[] {
  return ARTEN[art].map((typ) => ZONE_TYPEN.find((t) => t.typ === typ)!);
}

/** Beschriftung des i-ten von n Teilen: Objektname, sonst Ebenenname; gekürzt auf die Grenze. */
export function uebernahmeLabel(
  name: string | null,
  ebenenName: string,
  i: number,
  n: number,
): string {
  const basis = name?.trim() || ebenenName;
  const nummer = n > 1 ? ` (${i + 1}/${n})` : '';
  return basis.slice(0, ZONE_LABEL_MAX - nummer.length) + nummer;
}

/** Notiz einer übernommenen Zone: Herkunft, Leerzeile, Beschreibung; gekürzt auf die Grenze. */
export function uebernahmeNotiz(ebenenName: string, beschreibung: string | null): string {
  const satz = `Übernommen aus Fremdebene «${ebenenName}».`;
  const text = beschreibung?.trim() ? `${satz}\n\n${beschreibung.trim()}` : satz;
  return text.slice(0, ZONE_NOTIZ_MAX);
}
