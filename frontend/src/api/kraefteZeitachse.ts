import { apiGet, apiSend } from './client';
import type { EinheitPerioden, PersonPerioden, Zeitachse, ZeitachseNachtragBody } from './types';

/**
 * Kräfte-Zeitachse (LFH-552): Perioden je Einheit/Person, Zeitachse einer Kraft, Nachtrag und
 * Streichung. Die Pfade liegen unter den Modulen Einheiten bzw. Personal und erben deren Sperre.
 */
export type KraftArt = 'einheit' | 'person';

function kraftPfad(einsatzId: number, art: KraftArt, id: number): string {
  const modul = art === 'einheit' ? 'einheiten' : 'personal';
  return `/api/einsaetze/${einsatzId}/${modul}/${id}/zeitachse`;
}

/** Perioden je Einheit (nur Einheiten mit Ereignissen) — Spalte „Im Einsatz" im Meldebild. */
export function listeEinheitenPerioden(einsatzId: number): Promise<EinheitPerioden[]> {
  return apiGet<EinheitPerioden[]>(`/api/einsaetze/${einsatzId}/einheiten/zeitachse`);
}

/** Perioden je Person (nur Personen mit Ereignissen) — Personal-Seite. */
export function listePersonalPerioden(einsatzId: number): Promise<PersonPerioden[]> {
  return apiGet<PersonPerioden[]>(`/api/einsaetze/${einsatzId}/personal/zeitachse`);
}

export function ladeZeitachse(einsatzId: number, art: KraftArt, id: number): Promise<Zeitachse> {
  return apiGet<Zeitachse>(kraftPfad(einsatzId, art, id));
}

/** Nachtrag von Hand; an einer Einheit mit Fan-out auf ihre Personen. */
export function trageNach(
  einsatzId: number,
  art: KraftArt,
  id: number,
  body: ZeitachseNachtragBody,
): Promise<Zeitachse> {
  return apiSend<Zeitachse>(kraftPfad(einsatzId, art, id), 'POST', body);
}

/** Streicht ein Ereignis (unumkehrbar, Grund Pflicht); der alte Stand bleibt lesbar. */
export function streicheEreignis(
  einsatzId: number,
  art: KraftArt,
  id: number,
  ereignisId: number,
  grund: string,
): Promise<Zeitachse> {
  return apiSend<Zeitachse>(`${kraftPfad(einsatzId, art, id)}/${ereignisId}/streichen`, 'POST', {
    grund,
  });
}
