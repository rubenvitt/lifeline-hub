import type { Einheit } from './types';
import { apiGet, apiSend } from './client';

export interface EinheitEingabe {
  name: string;
  abschnitt_id?: number | null;
  ueber_einheit_id?: number | null;
  typ_id?: number | null;
  fuehrer_id?: number | null;
  soll_fuehrer?: number | null;
  soll_unterfuehrer?: number | null;
  soll_mannschaft?: number | null;
  bemerkung?: string | null;
  sortier?: number;
  /** LFH-109: IDs der zuzuordnenden Sprechgruppen aus dem Katalog. */
  sprechgruppe_ids?: number[];
  /** LFH-108: Funk/Kommunikation — Freitext-Schlüssel (digitalfunk/mobil/festnetz). */
  kommunikationsmittel?: string | null;
  /** LFH-108: Funk/Kommunikation — Rufnummer/Freitext (PII). */
  erreichbarkeit?: string | null;
}

export function listeEinheiten(einsatzId: number): Promise<Einheit[]> {
  return apiGet<Einheit[]>(`/api/einsaetze/${einsatzId}/einheiten`);
}

/** L‑2: Geo-Verortung eines taktischen Objekts. Felder werden nur gesendet, wenn
 *  gesetzt; `null` löscht explizit. lat/lon gehören zusammen (beide Zahl = setzen,
 *  beide null = löschen). */
export interface PositionPatch {
  lat?: number | null;
  lon?: number | null;
  tz_fachaufgabe?: string | null;
  tz_organisation?: string | null;
}

/** L‑2: Verortet eine Einheit auf der Lagekarte. */
export function verorteEinheit(
  einsatzId: number,
  einheitId: number,
  daten: PositionPatch,
): Promise<Einheit> {
  return apiSend<Einheit>(
    `/api/einsaetze/${einsatzId}/einheiten/${einheitId}/position`,
    'PATCH',
    daten,
  );
}

export function bildeEinheit(einsatzId: number, daten: EinheitEingabe): Promise<Einheit> {
  return apiSend<Einheit>(`/api/einsaetze/${einsatzId}/einheiten`, 'POST', daten);
}

export function aktualisiereEinheit(
  einsatzId: number,
  eid: number,
  daten: EinheitEingabe,
): Promise<Einheit> {
  return apiSend<Einheit>(`/api/einsaetze/${einsatzId}/einheiten/${eid}`, 'PATCH', daten);
}

export function loeseEinheitAuf(einsatzId: number, eid: number): Promise<void> {
  return apiSend<void>(`/api/einsaetze/${einsatzId}/einheiten/${eid}`, 'DELETE');
}

export function ordnePersonalZu(einsatzId: number, eid: number, epId: number): Promise<void> {
  return apiSend<void>(`/api/einsaetze/${einsatzId}/einheiten/${eid}/personal/${epId}`, 'PUT');
}

export function gibPersonalFrei(einsatzId: number, eid: number, epId: number): Promise<void> {
  return apiSend<void>(`/api/einsaetze/${einsatzId}/einheiten/${eid}/personal/${epId}`, 'DELETE');
}

export function ordneFahrzeugZu(einsatzId: number, eid: number, efId: number): Promise<void> {
  return apiSend<void>(`/api/einsaetze/${einsatzId}/einheiten/${eid}/fahrzeug/${efId}`, 'PUT');
}

export function gibFahrzeugFrei(einsatzId: number, eid: number, efId: number): Promise<void> {
  return apiSend<void>(`/api/einsaetze/${einsatzId}/einheiten/${eid}/fahrzeug/${efId}`, 'DELETE');
}
