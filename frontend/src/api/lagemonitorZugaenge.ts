import type { LesezugangAnzeige, LesezugangFreigabe, LesezugangMitSchluessel } from './types';
import { apiGet, apiSend } from './client';

// Lesezugänge externer Lagemonitore (LLH-1484): Verwaltung durch den System-Admin, Freigabe am
// Einsatz durch die Einsatzleitung. Den Abruf selbst macht der externe Monitor mit dem Schlüssel.

export function ladeLagemonitorZugaenge(): Promise<LesezugangAnzeige[]> {
  return apiGet<LesezugangAnzeige[]>('/api/lagemonitor-zugaenge');
}

/** Legt einen Zugang an; der Schlüssel steht nur in dieser Antwort. */
export function legeLagemonitorZugangAn(bezeichnung: string): Promise<LesezugangMitSchluessel> {
  return apiSend<LesezugangMitSchluessel>('/api/lagemonitor-zugaenge', 'POST', { bezeichnung });
}

export function widerrufeLagemonitorZugang(zugangId: number): Promise<LesezugangAnzeige> {
  return apiSend<LesezugangAnzeige>(`/api/lagemonitor-zugaenge/${zugangId}/widerrufen`, 'POST');
}

export function ladeLagemonitorFreigaben(einsatzId: number): Promise<LesezugangFreigabe[]> {
  return apiGet<LesezugangFreigabe[]>(`/api/einsaetze/${einsatzId}/lagemonitor-zugaenge`);
}

/** Gibt den Einsatz für den Zugang frei (an) oder beendet die Freigabe (aus). */
export function schalteLagemonitorFreigabe(
  einsatzId: number,
  zugangId: number,
  an: boolean,
): Promise<LesezugangFreigabe[]> {
  return apiSend<LesezugangFreigabe[]>(
    `/api/einsaetze/${einsatzId}/lagemonitor-zugaenge/${zugangId}/freigabe`,
    an ? 'PUT' : 'DELETE',
  );
}

/** Adresse, die der externe Monitor abfragt. */
export function lagemonitorAdresse(origin: string): string {
  return `${origin}/api/lagemonitor/v1/lage`;
}
