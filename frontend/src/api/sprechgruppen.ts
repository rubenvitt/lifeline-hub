import type { Sprechgruppe, SprechgruppeAuchLokal, SprechgruppeEingabe } from './types';
import { apiGet, apiSend } from './client';

export function listeSprechgruppen(nurAktive?: boolean): Promise<Sprechgruppe[]> {
  const qs = nurAktive !== undefined ? `?nur_aktive=${nurAktive}` : '';
  return apiGet<Sprechgruppe[]>(`/api/sprechgruppen${qs}`);
}

/** Katalog-Sprechgruppen mit gleichnamiger Einsatz-Sprechgruppe (LLH-1645, Altbestand). Admin. */
export function listeSprechgruppenAuchLokal(): Promise<SprechgruppeAuchLokal[]> {
  return apiGet<SprechgruppeAuchLokal[]>('/api/sprechgruppen/auch-lokal');
}

export function legeSprechgruppeAn(eingabe: SprechgruppeEingabe): Promise<Sprechgruppe> {
  return apiSend<Sprechgruppe>('/api/sprechgruppen', 'POST', eingabe);
}

export function aktualisiereSprechgruppe(
  id: number,
  eingabe: SprechgruppeEingabe,
): Promise<Sprechgruppe> {
  return apiSend<Sprechgruppe>(`/api/sprechgruppen/${id}`, 'PATCH', eingabe);
}

export function deaktiviereSprechgruppe(id: number): Promise<void> {
  return apiSend<void>(`/api/sprechgruppen/${id}/deaktivieren`, 'POST');
}

export function listeEinsatzSprechgruppen(einsatzId: number): Promise<Sprechgruppe[]> {
  return apiGet<Sprechgruppe[]>(`/api/einsaetze/${einsatzId}/sprechgruppen`);
}

export function legeEinsatzSprechgruppeAn(
  einsatzId: number,
  eingabe: { bezeichnung: string; betriebsart: import('./types').Betriebsart; hinweis?: string },
): Promise<Sprechgruppe> {
  return apiSend<Sprechgruppe>(`/api/einsaetze/${einsatzId}/sprechgruppen`, 'POST', eingabe);
}
