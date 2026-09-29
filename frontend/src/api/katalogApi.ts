import { apiGet, apiSend } from './client';

/**
 * Die vier Endpunkte eines org-weiten Stammdaten-Katalogs unter `pfad`:
 * Liste, Anlegen (POST), Ändern (PATCH `/{id}`) und Deaktivieren (POST `/{id}/deaktivieren`).
 */
export function katalogApi<T, E>(pfad: string) {
  return {
    liste: (): Promise<T[]> => apiGet<T[]>(pfad),
    legeAn: (daten: E): Promise<T> => apiSend<T>(pfad, 'POST', daten),
    aktualisiere: (id: number, daten: E): Promise<T> => apiSend<T>(`${pfad}/${id}`, 'PATCH', daten),
    deaktiviere: (id: number): Promise<void> => apiSend<void>(`${pfad}/${id}/deaktivieren`, 'POST'),
  };
}

/** Stammdatum (Fahrzeug, Personal, Material) in oder außer Dienst stellen. */
export function setzeDienststatusUnter<T>(pfad: string, id: number, inDienst: boolean): Promise<T> {
  return apiSend<T>(`${pfad}/${id}/${inDienst ? 'in-dienst' : 'ausser-dienst'}`, 'POST');
}
