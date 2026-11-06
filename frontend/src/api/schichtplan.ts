import { apiGet, apiSend } from './client';
import type {
  Schichtplan,
  SchichtplanBlockAendernBody,
  SchichtplanBlockBody,
  SchichtplanErzeugenBody,
  SchichtplanGrenzwerteBody,
  SchichtplanHelfer,
  SchichtplanHelferAendernBody,
  SchichtplanHelferBody,
} from './types';

/**
 * Schichtplan eines Einsatzes (LLH-1552): Blöcke an Einheiten, UHS und der Zeile „Pause“ mit
 * Soll und Prüfbefunden. Der Plan ist Soll, er ändert weder Zuordnung noch Fälligkeit. Jeder
 * Schreibweg eines Blocks liefert den ganzen Plan, weil sich Befunde anderer Blöcke mitändern.
 */
const basis = (einsatzId: number) => `/api/einsaetze/${einsatzId}/abloesungen/schichtplan`;

/** Ohne Freigabe des Moduls Personal sind `personen` und `helfer` `null`. */
export function fetchSchichtplan(einsatzId: number): Promise<Schichtplan> {
  return apiGet<Schichtplan>(basis(einsatzId));
}

/** Überschneidung am selben Posten (außer der Pause) ist 422. */
export function legeSchichtplanBlockAn(
  einsatzId: number,
  body: SchichtplanBlockBody,
): Promise<Schichtplan> {
  return apiSend<Schichtplan>(`${basis(einsatzId)}/bloecke`, 'POST', body);
}

/** Auch Verschieben in eine andere Zeile (`posten`); veralteter Stand ist 409. */
export function aendereSchichtplanBlock(
  einsatzId: number,
  blockId: number,
  body: SchichtplanBlockAendernBody,
): Promise<Schichtplan> {
  return apiSend<Schichtplan>(`${basis(einsatzId)}/bloecke/${blockId}`, 'PATCH', body);
}

export function loescheSchichtplanBlock(
  einsatzId: number,
  blockId: number,
  version: number,
): Promise<void> {
  return apiSend<void>(`${basis(einsatzId)}/bloecke/${blockId}?version=${version}`, 'DELETE');
}

/** Füllt den Zeitraum am Posten (alles oder nichts; Konflikte als 422 mit Zeilen). */
export function erzeugeSchichten(
  einsatzId: number,
  body: SchichtplanErzeugenBody,
): Promise<Schichtplan> {
  return apiSend<Schichtplan>(`${basis(einsatzId)}/erzeugen`, 'POST', body);
}

export function setzeSchichtplanGrenzwerte(
  einsatzId: number,
  body: SchichtplanGrenzwerteBody,
): Promise<Schichtplan> {
  return apiSend<Schichtplan>(`${basis(einsatzId)}/grenzwerte`, 'PATCH', body);
}

export function legeSchichtplanHelferAn(
  einsatzId: number,
  body: SchichtplanHelferBody,
): Promise<SchichtplanHelfer> {
  return apiSend<SchichtplanHelfer>(`${basis(einsatzId)}/helfer`, 'POST', body);
}

export function aendereSchichtplanHelfer(
  einsatzId: number,
  helferId: number,
  body: SchichtplanHelferAendernBody,
): Promise<SchichtplanHelfer> {
  return apiSend<SchichtplanHelfer>(`${basis(einsatzId)}/helfer/${helferId}`, 'PATCH', body);
}

/** Nimmt den Helfer aus allen Blöcken. */
export function loescheSchichtplanHelfer(einsatzId: number, helferId: number): Promise<void> {
  return apiSend<void>(`${basis(einsatzId)}/helfer/${helferId}`, 'DELETE');
}
