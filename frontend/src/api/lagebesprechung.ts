import { apiGet, apiSend } from './client';
import type {
  Lagebesprechung,
  LagebesprechungAbschlussBody,
  LagebesprechungStand,
  LagebesprechungTerminBody,
} from './types';

/**
 * Lagebesprechung als eigenes Modul (LLH-1111): Stand (nächster Termin, Zahl, letzte
 * Besprechung), Verlauf, Abschluss und Termin. Gate ist die Freigabe von `lagebesprechung`, nicht
 * die des Stabs.
 */
export function fetchLagebesprechungStand(einsatzId: number): Promise<LagebesprechungStand> {
  return apiGet<LagebesprechungStand>(`/api/einsaetze/${einsatzId}/lagebesprechung`);
}

/** Verlauf absteigend nach `lfd_nr`, ohne Cursor. */
export function fetchLagebesprechungen(einsatzId: number): Promise<Lagebesprechung[]> {
  return apiGet<Lagebesprechung[]>(`/api/einsaetze/${einsatzId}/lagebesprechungen`);
}

/**
 * 201 mit dem Stand, nach dem Commit frisch geladen. Die ETB-id steht NUR in
 * `letzte_lagebesprechung.etb_eintrag_id` und kann bei gleichzeitigem Abschluss eine fremde
 * Zeile sein — Zuordnung über `lagebesprechung/lagebesprechungAbschluss.ts:eigeneLagebesprechung`.
 */
export function lagebesprechungAbschliessen(
  einsatzId: number,
  daten: LagebesprechungAbschlussBody,
): Promise<LagebesprechungStand> {
  return apiSend<LagebesprechungStand>(
    `/api/einsaetze/${einsatzId}/lagebesprechungen`,
    'POST',
    daten,
  );
}

/** Termin ohne Abschluss setzen (`null` = kein Termin); kein ETB-Eintrag (design.md D3). */
export function setLagebesprechungTermin(
  einsatzId: number,
  daten: LagebesprechungTerminBody,
): Promise<LagebesprechungStand> {
  return apiSend<LagebesprechungStand>(
    `/api/einsaetze/${einsatzId}/lagebesprechung/termin`,
    'PUT',
    daten,
  );
}
