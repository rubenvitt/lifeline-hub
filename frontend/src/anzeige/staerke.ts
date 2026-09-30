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
 * Gezählt werden nur die **Wurzeln der Menge** — Einheiten, von denen kein Vorfahr (nicht nur der
 * direkte) selbst in der Menge steckt. Die kumulierte Stärke einer Einheit enthält alle ihre
 * Unterstellten; stünden beide in der Summe, zählte die Untereinheit doppelt (LFH-550). Die Kette
 * läuft über `alle` (die Einheiten des Einsatzes), damit ein fehlendes Zwischenglied sie nicht
 * abreißt; ohne `alle` gilt die Menge selbst. Ein korrupter Zyklus (der Server kumuliert
 * zyklussicher) zählt über sein Mitglied mit der kleinsten Kennung genau einmal. Die Regel steht
 * im gemeinsamen Fixture `tests/fixtures/verdichtung/regeln.json`.
 */
export function summiereStaerke(
  einheiten: ReadonlyArray<StaerkeTraeger>,
  alle: ReadonlyArray<Pick<StaerkeTraeger, 'id' | 'ueber_einheit_id'>> = einheiten,
): Staerke | null {
  if (einheiten.length === 0) return null;
  const inMenge = new Set(einheiten.map((e) => e.id));
  const eltern = new Map<number, number | null>();
  for (const e of alle) eltern.set(e.id, e.ueber_einheit_id ?? null);
  for (const e of einheiten) if (!eltern.has(e.id)) eltern.set(e.id, e.ueber_einheit_id ?? null);

  /** Die oberste Einheit der Menge auf dem Weg nach oben; im Zyklus die kleinste Kennung. */
  const oberste = (id: number): number => {
    const pfad = [id];
    const gesehen = new Set(pfad);
    let p = eltern.get(id) ?? null;
    while (p != null && !gesehen.has(p)) {
      gesehen.add(p);
      pfad.push(p);
      p = eltern.get(p) ?? null;
    }
    if (p != null) {
      const ring = pfad.slice(pfad.indexOf(p)).filter((x) => inMenge.has(x));
      if (ring.length > 0) return Math.min(...ring);
    }
    const imPfad = pfad.filter((x) => inMenge.has(x));
    return imPfad[imPfad.length - 1];
  };

  return einheiten
    .filter((e) => oberste(e.id) === e.id)
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
