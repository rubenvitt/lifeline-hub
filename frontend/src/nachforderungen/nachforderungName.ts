import type { Nachforderung } from '../api/types';

/**
 * Kurzname einer Nachforderung, wie der Server ihn im ETB schreibt: „2× RTW“, ohne Anzahl nur
 * die Art (`src/nachforderung/repo.rs:kurzname`).
 */
export function nachforderungKurzname(n: Pick<Nachforderung, 'anzahl' | 'art'>): string {
  return n.anzahl != null ? `${n.anzahl}× ${n.art}` : n.art;
}

/**
 * Name einer Nachforderung, wo sie in einer Liste oder Auswahl steht (LLH-1089, design.md D10):
 * der Kurzname, mit Details „2× RTW — Transport aus der UHS“. Die Details sind seit LLH-1089
 * optional und nennen deshalb die Nachforderung nicht mehr allein.
 */
export function nachforderungName(
  n: Pick<Nachforderung, 'anzahl' | 'art' | 'bezeichnung'>,
): string {
  const kurz = nachforderungKurzname(n);
  const details = n.bezeichnung?.trim();
  return details ? `${kurz} — ${details}` : kurz;
}
