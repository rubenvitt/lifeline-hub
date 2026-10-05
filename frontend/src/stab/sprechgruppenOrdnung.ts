import type { Sprechgruppe } from '../api/types';

/**
 * Die Ordnung der Sprechgruppen eines Einsatzes: TMO vor DMO, sonst wie die Quelle
 * (`ORDER BY sortier, bezeichnung` in `src/sprechgruppe/repo.rs`, deshalb binär verglichen). Die
 * Quelle selbst ordnet nach `betriebsart` alphabetisch, also DMO zuerst; das kehrt die Spec um.
 * Eine Ordnung für Kanalbelegung (`stab/sprechgruppenplan.ts`, LFH-848 D8), Lücken und die
 * Schienen der Fernmeldeskizze (LFH-893 D2).
 */
const BETRIEBSART_RANG: Record<string, number> = { TMO: 0, DMO: 1 };

/** Binär wie SQLites Standardkollation, damit die Ordnung der Quelle erhalten bleibt. */
function binaer(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function vergleicheSprechgruppen(a: Sprechgruppe, b: Sprechgruppe): number {
  return (
    (BETRIEBSART_RANG[a.betriebsart] ?? 2) - (BETRIEBSART_RANG[b.betriebsart] ?? 2) ||
    a.sortier - b.sortier ||
    binaer(a.bezeichnung, b.bezeichnung) ||
    a.id - b.id
  );
}
