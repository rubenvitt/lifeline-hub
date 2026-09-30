import { apiGet, apiSend } from './client';
import type {
  BesetzungBody,
  ChecklistenEintrag,
  ChecklistenPunkt,
  ChecklistenPunktBody,
  Lagebesprechung,
  LagebesprechungAbschlussBody,
  Sachgebiet,
  Stab,
} from './types';

/** Führungsorganisation eines Einsatzes (LFH-46). `besetzung` trägt nur belegte Zeilen. */
export function ladeStab(einsatzId: number): Promise<Stab> {
  return apiGet<Stab>(`/api/einsaetze/${einsatzId}/stab`);
}

export function setzeBesetzung(
  einsatzId: number,
  sachgebiet: Sachgebiet,
  daten: BesetzungBody,
): Promise<Stab> {
  return apiSend<Stab>(`/api/einsaetze/${einsatzId}/stab/besetzung/${sachgebiet}`, 'PUT', daten);
}

/** 204 ohne Body — auch auf einer leeren Zeile (idempotent, Spec 9.2). */
export function entferneBesetzung(einsatzId: number, sachgebiet: Sachgebiet): Promise<void> {
  return apiSend<void>(`/api/einsaetze/${einsatzId}/stab/besetzung/${sachgebiet}`, 'DELETE');
}

/** Historie absteigend nach `lfd_nr`, ohne Cursor (Spec 9). */
export function ladeLagebesprechungen(einsatzId: number): Promise<Lagebesprechung[]> {
  return apiGet<Lagebesprechung[]>(`/api/einsaetze/${einsatzId}/stab/lagebesprechungen`);
}

/**
 * 201 mit `StabAnzeige`, nach dem Commit frisch geladen. Die ETB-id steht NUR in
 * `letzte_lagebesprechung.etb_eintrag_id` und kann bei gleichzeitigem Abschluss eine fremde
 * Zeile sein — Zuordnung über `stab/lagebesprechungAbschluss.ts:eigeneLagebesprechung`.
 */
export function schliesseLagebesprechungAb(
  einsatzId: number,
  daten: LagebesprechungAbschlussBody,
): Promise<Stab> {
  return apiSend<Stab>(`/api/einsaetze/${einsatzId}/stab/lagebesprechungen`, 'POST', daten);
}

/** Gespeicherte Punkte der Checkliste Arbeitsaufnahme (LFH-551); fehlend = offen. */
export function ladeCheckliste(einsatzId: number): Promise<ChecklistenEintrag[]> {
  return apiGet<ChecklistenEintrag[]>(`/api/einsaetze/${einsatzId}/stab/checkliste`);
}

/**
 * Setzt Haken ODER Bemerkung eines Punkts; die Antwort ist die ganze Checkliste nach dem Commit.
 * Aufrufer schicken genau das Feld ihres Bedienziels (Design D3).
 */
export function setzeChecklistenPunkt(
  einsatzId: number,
  punkt: ChecklistenPunkt,
  daten: ChecklistenPunktBody,
): Promise<ChecklistenEintrag[]> {
  return apiSend<ChecklistenEintrag[]>(
    `/api/einsaetze/${einsatzId}/stab/checkliste/${punkt}`,
    'PUT',
    daten,
  );
}
