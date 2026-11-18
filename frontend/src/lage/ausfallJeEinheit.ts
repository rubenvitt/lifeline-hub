/**
 * Ausfall je Einheit aus dem Meldebild selbst (LLH-1739, verlegt mit LLH-1743): dieselben Gründe
 * der Tönung, die dort in der Statusspalte stehen (`toenungsGruende`), auch die der Sammelzeile
 * „Ohne Einheit“ (unter {@link OHNE_EINHEIT}). Jede Einheit zählt nur ihre eigenen Mittel (Spec
 * `kraeftebaum`), die Summe über einen Teilbaum zählt also keine Kraft doppelt. Eine Heimat für
 * „Ausfall“ (`frontend/AGENTS.md`, „Eine Heimat je Zahl“): die Abschnittskarte im Überblick und
 * die Alarmzeile (`lage/wasBrennt.ts`) lesen beide von hier. Der Server zählt dieselbe Regel für
 * den Lagemonitor nach (`einsatz::ausfall`, LLH-1929); das Fixture `regeln.json`, Abschnitt
 * `ausfall`, bindet beide Seiten.
 */
import type { Rohdaten } from '../kraefte/kraeftebild';
import type { Benannt } from './wasBrennt';
import {
  baueMeldebildRaster,
  einheitZeilen,
  OHNE_EINHEIT_SCHLUESSEL,
  toenungsGruende,
} from '../kraefte/meldebildRaster';

/** Schlüssel der Meldebild-Zeile „Ohne Einheit“ in {@link ausfallJeEinheit}. */
export const OHNE_EINHEIT = 'ohne-einheit';

export interface AusfallDerEinheit {
  mittel: number;
  material: number;
  /** Bezeichnung der Zeile im Meldebild. */
  bezeichnung: string;
}

export function ausfallJeEinheit(
  r: Rohdaten,
): Map<number | typeof OHNE_EINHEIT, AusfallDerEinheit> {
  const raster = baueMeldebildRaster({ ...r, statusKatalog: [], auftraege: [] });
  const je = new Map<number | typeof OHNE_EINHEIT, AusfallDerEinheit>();
  for (const z of einheitZeilen(raster)) {
    const schluessel = z.einheitId ?? (z.key === OHNE_EINHEIT_SCHLUESSEL ? OHNE_EINHEIT : null);
    if (schluessel == null) continue;
    let mittel = 0;
    let material = 0;
    for (const g of toenungsGruende(z, null)) {
      if (g.art === 'ausfall') mittel += g.anzahl;
      if (g.art === 'ausfall_material') material += g.anzahl;
    }
    je.set(schluessel, { mittel, material, bezeichnung: z.bezeichnung });
  }
  return je;
}

/**
 * Die Einheiten mit Ausfall (Mittel oder Material) für die Alarmzeile, in der Folge der
 * Einheitenliste: `sortier`, dann `id`, „Ohne Einheit“ zuletzt (LLH-1929, Spec `lage-alarmzeile`).
 * Dieselbe Folge liefert der Server dem Lagemonitor (`einsatz::ausfall`), deshalb nicht die
 * Baumfolge des Meldebilds.
 */
export function einheitenMitAusfall(r: Rohdaten): Benannt[] {
  const sortier = new Map(r.einheiten.map((e) => [e.id, e.sortier]));
  const folge = (x: number | typeof OHNE_EINHEIT, y: number | typeof OHNE_EINHEIT): number => {
    if (x === OHNE_EINHEIT || y === OHNE_EINHEIT)
      return (x === OHNE_EINHEIT ? 1 : 0) - (y === OHNE_EINHEIT ? 1 : 0);
    return (sortier.get(x) ?? 0) - (sortier.get(y) ?? 0) || x - y;
  };
  return [...ausfallJeEinheit(r).entries()]
    .filter(([, a]) => a.mittel + a.material > 0)
    .sort(([x], [y]) => folge(x, y))
    .map(([k, a]) => ({ id: k === OHNE_EINHEIT ? null : k, name: a.bezeichnung }));
}
