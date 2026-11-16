/**
 * Ausfall je Einheit aus dem Meldebild selbst (LLH-1739, verlegt mit LLH-1743): dieselben Gründe
 * der Tönung, die dort in der Statusspalte stehen (`toenungsGruende`), auch die der Sammelzeile
 * „Ohne Einheit“ (unter {@link OHNE_EINHEIT}). Jede Einheit zählt nur ihre eigenen Mittel (Spec
 * `kraeftebaum`), die Summe über einen Teilbaum zählt also keine Kraft doppelt. Eine Heimat für
 * „Ausfall“ (`frontend/AGENTS.md`, „Eine Heimat je Zahl“): die Abschnittskarte im Überblick und
 * die Alarmzeile (`lage/wasBrennt.ts`) lesen beide von hier.
 */
import type { Rohdaten } from '../kraefte/kraeftebild';
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
