import { apiGet, apiSend } from './client';
import type {
  Abloesung,
  AbloesungVollzug,
  AbloesungVorgabe,
  SchichtAendernBody,
  SchichtBeginnenBody,
  VollzugBody,
} from './types';

/** Ablösung (LFH-635): Schichten von Einheiten, Rhythmus-Vorgaben je Abschnitt. */
const basis = (einsatzId: number) => `/api/einsaetze/${einsatzId}/abloesungen`;

/** Laufende nach Fälligkeit, abgelöste nach Vollzug absteigend (Ordnung vom Server). */
export function listeAbloesungen(
  einsatzId: number,
  status: 'laufend' | 'abgeloest',
): Promise<Abloesung[]> {
  return apiGet<Abloesung[]>(`${basis(einsatzId)}?status=${status}`);
}

export function beginneSchicht(einsatzId: number, body: SchichtBeginnenBody): Promise<Abloesung> {
  return apiSend<Abloesung>(basis(einsatzId), 'POST', body);
}

export function aendereSchicht(
  einsatzId: number,
  abloesungId: number,
  body: SchichtAendernBody,
): Promise<Abloesung> {
  return apiSend<Abloesung>(`${basis(einsatzId)}/${abloesungId}`, 'PATCH', body);
}

/** Vollzug; mit ablösender Einheit entsteht deren Folgeschicht. */
export function vollzieheAbloesung(
  einsatzId: number,
  abloesungId: number,
  body: VollzugBody,
): Promise<AbloesungVollzug> {
  return apiSend<AbloesungVollzug>(`${basis(einsatzId)}/${abloesungId}/vollzug`, 'POST', body);
}

/** Rückweg des Vollzugs, solange die Folgeschicht unberührt ist (sonst 422). */
export function nimmVollzugZurueck(einsatzId: number, abloesungId: number): Promise<Abloesung> {
  return apiSend<Abloesung>(`${basis(einsatzId)}/${abloesungId}/vollzug/zuruecknehmen`, 'POST', {});
}

export function listeAbloesungVorgaben(einsatzId: number): Promise<AbloesungVorgabe[]> {
  return apiGet<AbloesungVorgabe[]>(`${basis(einsatzId)}/vorgaben`);
}

/** `null` entfernt die Vorgabe; laufende Schichten behalten dann ihren Rhythmus. */
export function setzeAbloesungVorgabe(
  einsatzId: number,
  abschnittId: number,
  rhythmusMinuten: number | null,
): Promise<AbloesungVorgabe[]> {
  return apiSend<AbloesungVorgabe[]>(`${basis(einsatzId)}/vorgaben/${abschnittId}`, 'PUT', {
    rhythmus_minuten: rhythmusMinuten,
  });
}
