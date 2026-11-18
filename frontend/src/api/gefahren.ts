import type {
  GefahrBewertung,
  Gefahrengebiet,
  Gefahrentyp,
  Schutzobjekt,
  Warnstufe,
} from './types';
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

export function ladeMatrix(
  einsatzId: number,
  gefahrengebietId: number,
): Promise<GefahrBewertung[]> {
  return apiGet<GefahrBewertung[]>(
    `/api/einsaetze/${einsatzId}/gefahrengebiete/${gefahrengebietId}/matrix`,
  );
}

export function setzeBewertung(
  einsatzId: number,
  gefahrengebietId: number,
  daten: BewertungEingabe,
): Promise<GefahrBewertung> {
  return apiSend<GefahrBewertung>(
    `/api/einsaetze/${einsatzId}/gefahrengebiete/${gefahrengebietId}/matrix/bewertung`,
    'PUT',
    daten,
  );
}

/** Bestätigt die Beurteilung der Matrix eines Gebiets (LLH-1090); Antwort ist das Gebiet. */
export function bestaetigeBeurteilung(
  einsatzId: number,
  gefahrengebietId: number,
): Promise<Gefahrengebiet> {
  return apiSend<Gefahrengebiet>(
    `/api/einsaetze/${einsatzId}/gefahrengebiete/${gefahrengebietId}/beurteilung`,
    'POST',
  );
}

/**
 * Benennt ein Gebiet um. `erwartet` ist die Bezeichnung beim Öffnen (Feld-CAS, LLH-1945): hat sie
 * ein anderer inzwischen geändert, antwortet der Server 409 `veraltet`; ohne `erwartet` schreibt er
 * ohne Vergleich.
 */
export function benenneGefahrengebiet(
  einsatzId: number,
  gefahrengebietId: number,
  label: string | null,
  erwartet?: { label: string | null },
): Promise<Gefahrengebiet> {
  return apiSend<Gefahrengebiet>(
    `/api/einsaetze/${einsatzId}/gefahrengebiete/${gefahrengebietId}`,
    'PATCH',
    erwartet ? { label, erwartet } : { label },
  );
}

/** Anzeigename eines Gefahrengebiets: Label, sonst Fallback „Gefahrengebiet #<id>". */
export function gefahrengebietName(label: string | null | undefined, id: number): string {
  return label?.trim() ? label : `Gefahrengebiet #${id}`;
}
