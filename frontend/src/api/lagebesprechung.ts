import { apiDatei, apiGet, apiSend } from './client';
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
  return apiGet<LagebesprechungStand>(`/api/incidents/${einsatzId}/briefing`);
}

/** Verlauf absteigend nach `lfd_nr`, ohne Cursor. */
export function fetchLagebesprechungen(einsatzId: number): Promise<Lagebesprechung[]> {
  return apiGet<Lagebesprechung[]>(`/api/incidents/${einsatzId}/briefings`);
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
  return apiSend<LagebesprechungStand>(`/api/incidents/${einsatzId}/briefings`, 'POST', daten);
}

/** Termin ohne Abschluss setzen (`null` = kein Termin); kein ETB-Eintrag (design.md D3). */
export function setLagebesprechungTermin(
  einsatzId: number,
  daten: LagebesprechungTerminBody,
): Promise<LagebesprechungStand> {
  return apiSend<LagebesprechungStand>(
    `/api/incidents/${einsatzId}/briefing/schedule`,
    'PUT',
    daten,
  );
}

/**
 * Der nächste Termin als ICS-Datei (nur lesend, Gate: Lesezugriff auf das Modul). 404, wenn kein
 * Termin gesetzt ist; der Aufrufer zeigt den Fehler an der Seite.
 */
export function fetchLagebesprechungIcs(einsatzId: number): Promise<Blob> {
  return apiDatei(`/api/incidents/${einsatzId}/briefing/schedule/export`);
}
