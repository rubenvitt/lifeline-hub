import { apiDatei, apiGet, apiSend } from './client';
import type { ProgrammpunktEingabe } from './programmpunkte';
import type {
  Planung,
  PlanungAendernBody,
  PlanungBlockAendernBody,
  PlanungBlockBody,
  PlanungBody,
  PlanungErzeugenBody,
  PlanungListeneintrag,
  PlanungPostenAendernBody,
  PlanungPostenBody,
  PlanungUebernahmeBody,
  PlanungUebernahmeErgebnis,
  PlanungUebernahmeVorschau,
  PlanungUebernehmenBody,
  Programmpunkt,
  SchichtplanHelfer,
  SchichtplanHelferAendernBody,
  SchichtplanHelferBody,
} from './types';

/**
 * Vorplanung ohne Einsatz (LLH-1561, Spec `vorplanung`): Planungen der eigenen Organisation mit
 * Posten, Blöcken und Helfern. Lesen und schreiben nur System-Admin und org-weite Führungskraft
 * (sonst 403), eine fremde Planung ist 404. Jeder Schreibweg an Planung, Posten und Blöcken liefert
 * die ganze Planung, weil sich Befunde und Kennzahlen mitändern; live kommt sie über `planung`.
 */
const basis = (id: number) => `/api/planungen/${id}`;

/** Offene zuerst, dann nach Beginn; ältere ohne gerechnete Kennzahlen. */
export function listePlanungen(): Promise<PlanungListeneintrag[]> {
  return apiGet<PlanungListeneintrag[]>('/api/planungen');
}

export function ladePlanung(id: number): Promise<Planung> {
  return apiGet<Planung>(basis(id));
}

/** Bezeichnung doppelt (ohne Groß und Klein) ist 409, Zeitraum über 14 Tage 400. */
export function createPlanung(body: PlanungBody): Promise<Planung> {
  return apiSend<Planung>('/api/planungen', 'POST', body);
}

export function updatePlanung(id: number, body: PlanungAendernBody): Promise<Planung> {
  return apiSend<Planung>(basis(id), 'PATCH', body);
}

export function deletePlanung(id: number): Promise<void> {
  return apiSend<void>(basis(id), 'DELETE');
}

export function createPlanungPosten(id: number, body: PlanungPostenBody): Promise<Planung> {
  return apiSend<Planung>(`${basis(id)}/posten`, 'POST', body);
}

export function updatePlanungPosten(
  id: number,
  postenId: number,
  body: PlanungPostenAendernBody,
): Promise<Planung> {
  return apiSend<Planung>(`${basis(id)}/posten/${postenId}`, 'PATCH', body);
}

/** Mit Personen in seinen Blöcken nur mit `mitBloecken` (422 sonst). */
export function deletePlanungPosten(
  id: number,
  postenId: number,
  mitBloecken: boolean,
): Promise<void> {
  const query = mitBloecken ? '?mit_bloecken=true' : '';
  return apiSend<void>(`${basis(id)}/posten/${postenId}${query}`, 'DELETE');
}

/** Die ganze Reihenfolge, jeder Posten genau einmal (422 sonst). */
export function updatePlanungPostenReihenfolge(id: number, postenIds: number[]): Promise<Planung> {
  return apiSend<Planung>(`${basis(id)}/posten/reihenfolge`, 'PUT', { posten_ids: postenIds });
}

/** Überschneidung am selben Posten (außer der Pause) ist 422. */
export function createPlanungBlock(id: number, body: PlanungBlockBody): Promise<Planung> {
  return apiSend<Planung>(`${basis(id)}/bloecke`, 'POST', body);
}

/** Auch Verschieben an einen anderen Posten; veralteter Stand ist 409. */
export function updatePlanungBlock(
  id: number,
  blockId: number,
  body: PlanungBlockAendernBody,
): Promise<Planung> {
  return apiSend<Planung>(`${basis(id)}/bloecke/${blockId}`, 'PATCH', body);
}

export function deletePlanungBlock(id: number, blockId: number, version: number): Promise<void> {
  return apiSend<void>(`${basis(id)}/bloecke/${blockId}?version=${version}`, 'DELETE');
}

/** Füllt den Zeitraum am Posten (alles oder nichts; Konflikte als 422 mit Zeilen). */
export function erzeugePlanungSchichten(id: number, body: PlanungErzeugenBody): Promise<Planung> {
  return apiSend<Planung>(`${basis(id)}/erzeugen`, 'POST', body);
}

export function createPlanungHelfer(
  id: number,
  body: SchichtplanHelferBody,
): Promise<SchichtplanHelfer> {
  return apiSend<SchichtplanHelfer>(`${basis(id)}/helfer`, 'POST', body);
}

export function updatePlanungHelfer(
  id: number,
  helferId: number,
  body: SchichtplanHelferAendernBody,
): Promise<SchichtplanHelfer> {
  return apiSend<SchichtplanHelfer>(`${basis(id)}/helfer/${helferId}`, 'PATCH', body);
}

/** Nimmt den Helfer aus allen Blöcken. */
export function deletePlanungHelfer(id: number, helferId: number): Promise<void> {
  return apiSend<void>(`${basis(id)}/helfer/${helferId}`, 'DELETE');
}

/**
 * Programmpunkte der Planung (LLH-1583): dieselben Grenzen wie am Einsatz (höchstens 50, sonst
 * 422). Die Übernahme legt sie im Einsatz an; danach ist jeder Schreibweg 409.
 */
export function createPlanungProgrammpunkt(
  id: number,
  daten: ProgrammpunktEingabe,
): Promise<Programmpunkt> {
  return apiSend<Programmpunkt>(`${basis(id)}/programmpunkte`, 'POST', daten);
}

export function updatePlanungProgrammpunkt(
  id: number,
  punktId: number,
  daten: Partial<ProgrammpunktEingabe>,
): Promise<Programmpunkt> {
  return apiSend<Programmpunkt>(`${basis(id)}/programmpunkte/${punktId}`, 'PATCH', daten);
}

export function deletePlanungProgrammpunkt(id: number, punktId: number): Promise<void> {
  return apiSend<void>(`${basis(id)}/programmpunkte/${punktId}`, 'DELETE');
}

/**
 * Vorschau der Übernahme in einen neuen oder laufenden Einsatz (LLH-1587): schreibt nichts,
 * Fehler stehen in der Antwort (`uebernehmbar: false`). Ein fremder Einsatz ist 404, ohne
 * Schreibrecht 403, ein abgeschlossener oder eine schon übernommene Planung 409. `stand` ist der
 * Stand der Planung, auf dem sie beruht (LLH-1610).
 */
export function planungUebernahmeVorschau(
  id: number,
  body: PlanungUebernahmeBody,
): Promise<PlanungUebernahmeVorschau> {
  return apiSend<PlanungUebernahmeVorschau>(`${basis(id)}/uebernahme/vorschau`, 'POST', body);
}

/**
 * Übernimmt in EINER Transaktion; danach ist die Planung schreibgeschützt (jeder Schreibweg 409).
 * Hat sich die Planung seit der Vorschau (`stand`) geändert, 409 (LLH-1610).
 */
export function planungUebernehmen(
  id: number,
  body: PlanungUebernehmenBody,
): Promise<PlanungUebernahmeErgebnis> {
  return apiSend<PlanungUebernahmeErgebnis>(`${basis(id)}/uebernahme`, 'POST', body);
}

/** Zeit für das Schreiben einer großen Mappe, wie beim Schichtplan eines Einsatzes. */
const MAPPE_TIMEOUT_MS = 60_000;

/**
 * Die Planung als Excel-Mappe (LLH-1557 Teil B, Spec `vorplanung`): dieselben Blätter wie der
 * Schichtplan eines Einsatzes, Zeiten in der Zone der Organisation. Der Server schickt keinen
 * Dateinamen.
 */
export function loadPlanungMappe(id: number): Promise<Blob> {
  return apiDatei(`${basis(id)}/export`, { timeoutMs: MAPPE_TIMEOUT_MS });
}
