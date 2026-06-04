import type { GefahrBewertung, Gefahrentyp, Schutzobjekt, Warnstufe } from './types';
import { apiGet, apiSend } from './client';

export interface BewertungEingabe {
  gefahrentyp: Gefahrentyp;
  schutzobjekt: Schutzobjekt;
  warnstufe: Warnstufe;
  beschreibung?: string | null;
  gemeldet_von?: string | null;
}

export function ladeGefahrenmatrix(einsatzId: number): Promise<GefahrBewertung[]> {
  return apiGet<GefahrBewertung[]>(`/api/einsaetze/${einsatzId}/gefahrenmatrix`);
}

export function setzeBewertung(einsatzId: number, daten: BewertungEingabe): Promise<GefahrBewertung> {
  return apiSend<GefahrBewertung>(`/api/einsaetze/${einsatzId}/gefahrenmatrix/bewertung`, 'PUT', daten);
}
