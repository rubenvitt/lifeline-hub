import type { Einsatzabschnitt } from './types';
import { apiGet, apiSend } from './client';

export interface AbschnittEingabe {
  name: string;
  ueber_abschnitt_id?: number | null;
  leiter_id?: number | null;
  bemerkung?: string | null;
  sprechgruppe_tmo?: string | null;
  sprechgruppe_dmo?: string | null;
  kommunikationsmittel?: string | null;
  erreichbarkeit?: string | null;
  sortier?: number;
}

export function listeAbschnitte(einsatzId: number): Promise<Einsatzabschnitt[]> {
  return apiGet<Einsatzabschnitt[]>(`/api/einsaetze/${einsatzId}/abschnitte`);
}

export function legeAbschnittAn(einsatzId: number, daten: AbschnittEingabe): Promise<Einsatzabschnitt> {
  return apiSend<Einsatzabschnitt>(`/api/einsaetze/${einsatzId}/abschnitte`, 'POST', daten);
}

export function aktualisiereAbschnitt(einsatzId: number, aid: number, daten: AbschnittEingabe): Promise<Einsatzabschnitt> {
  return apiSend<Einsatzabschnitt>(`/api/einsaetze/${einsatzId}/abschnitte/${aid}`, 'PATCH', daten);
}

export function loeseAbschnittAuf(einsatzId: number, aid: number): Promise<void> {
  return apiSend<void>(`/api/einsaetze/${einsatzId}/abschnitte/${aid}`, 'DELETE');
}

/** L‑2: Fläche (GeoJSON-String) und Verortungs-Metadaten eines Abschnitts.
 *  `null` löscht explizit, undefined = unverändert. */
export interface FlaechePatch {
  flaeche_geojson?: string | null;
  tz_fachaufgabe?: string | null;
  tz_organisation?: string | null;
}

/** L‑2: Zeichnet/aktualisiert die taktische Fläche eines Abschnitts. */
export function zeichneAbschnitt(einsatzId: number, aid: number, daten: FlaechePatch): Promise<Einsatzabschnitt> {
  return apiSend<Einsatzabschnitt>(`/api/einsaetze/${einsatzId}/abschnitte/${aid}/flaeche`, 'PATCH', daten);
}
