import type { Staerke } from '../api/types';

/** Was eine Stärkesumme von einer Einheit braucht: die Kennung, die Unterstellung und die
 *  kumulierte Ist-Stärke (Server, eigene + alle unterstellten). */
export interface StaerkeTraeger {
  id: number;
  ueber_einheit_id?: number | null;
  ist_kumuliert: Staerke;
}

/**
 * Summe der kumulierten Ist-Stärke einer Einheitenmenge, oder `null` bei leerer Menge:
 * „keine Einheit zugeordnet" ist eine andere Aussage als „null Personen".
 *
 * Gezählt werden nur die **Wurzeln der Menge** — Einheiten, deren übergeordnete Einheit nicht
 * selbst in der Menge steckt. Die kumulierte Stärke einer Einheit enthält ihre Unterstellten
 * schon; stünden beide in der Summe, zählte die Untereinheit doppelt (LFH-550). Die Regel steht
 * im gemeinsamen Fixture `tests/fixtures/verdichtung/regeln.json`.
 */
export function summiereStaerke(einheiten: ReadonlyArray<StaerkeTraeger>): Staerke | null {
  if (einheiten.length === 0) return null;
  const ids = new Set(einheiten.map((e) => e.id));
  return einheiten
    .filter((e) => e.ueber_einheit_id == null || !ids.has(e.ueber_einheit_id))
    .reduce<Staerke>(
      (acc, e) => ({
        fuehrer: acc.fuehrer + (e.ist_kumuliert?.fuehrer ?? 0),
        unterfuehrer: acc.unterfuehrer + (e.ist_kumuliert?.unterfuehrer ?? 0),
        mannschaft: acc.mannschaft + (e.ist_kumuliert?.mannschaft ?? 0),
      }),
      { fuehrer: 0, unterfuehrer: 0, mannschaft: 0 },
    );
}

/**
 * Stärke in BOS-Schreibweise `F/UF/M//Σ` (Doppelstrich vor der Gesamtstärke), „—" ohne Angabe.
 * Die EINE Formatierung (LFH-550): das Meldebild (`kraefte/kraeftebild.ts`) formatiert hierüber.
 */
export function staerkeText(s: Staerke | null | undefined): string {
  if (!s) return '—';
  const { fuehrer, unterfuehrer, mannschaft } = s;
  return `${fuehrer}/${unterfuehrer}/${mannschaft}//${fuehrer + unterfuehrer + mannschaft}`;
}
