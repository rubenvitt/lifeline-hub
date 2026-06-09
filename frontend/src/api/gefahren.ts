import type { GefahrBewertung, Gefahrengebiet, Gefahrentyp, Schutzobjekt, Warnstufe } from './types';
import { apiGet, apiSend } from './client';

export interface BewertungEingabe {
  gefahrentyp: Gefahrentyp;
  schutzobjekt: Schutzobjekt;
  warnstufe: Warnstufe;
  beschreibung?: string | null;
  gemeldet_von?: string | null;
}

export function ladeGefahrengebiete(einsatzId: number): Promise<Gefahrengebiet[]> {
  return apiGet<Gefahrengebiet[]>(`/api/einsaetze/${einsatzId}/gefahrengebiete`);
}

export function ladeMatrix(einsatzId: number, gefahrengebietId: number): Promise<GefahrBewertung[]> {
  return apiGet<GefahrBewertung[]>(`/api/einsaetze/${einsatzId}/gefahrengebiete/${gefahrengebietId}/matrix`);
}

export function setzeBewertung(einsatzId: number, gefahrengebietId: number, daten: BewertungEingabe): Promise<GefahrBewertung> {
  return apiSend<GefahrBewertung>(`/api/einsaetze/${einsatzId}/gefahrengebiete/${gefahrengebietId}/matrix/bewertung`, 'PUT', daten);
}

export function benenneGefahrengebiet(einsatzId: number, gefahrengebietId: number, label: string | null): Promise<Gefahrengebiet> {
  return apiSend<Gefahrengebiet>(`/api/einsaetze/${einsatzId}/gefahrengebiete/${gefahrengebietId}`, 'PATCH', { label });
}
