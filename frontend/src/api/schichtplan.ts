import { apiDatei, apiGet, apiSend, apiUpload } from './client';
import type {
  Schichtplan,
  SchichtplanEntscheidungenEingabe,
  SchichtplanImportErgebnis,
  SchichtplanImportVorschau,
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

function einleseDaten(datei: File, entscheidungen: SchichtplanEntscheidungenEingabe): FormData {
  const daten = new FormData();
  daten.append('datei', datei);
  daten.append('entscheidungen', JSON.stringify(entscheidungen));
  return daten;
}

/** Zeit für Lesen und Abgleich einer großen Datei (bis 5.000 Zeilen). */
const EINLESEN_TIMEOUT_MS = 60_000;

/**
 * Schichtplan einlesen, Vorschau (LLH-1556): schreibt nichts; Fehler stehen in der Antwort
 * (`uebernehmbar: false`). Eine unlesbare Datei ist 400.
 */
export function schichtplanEinlesenVorschau(
  einsatzId: number,
  datei: File,
  entscheidungen: SchichtplanEntscheidungenEingabe,
): Promise<SchichtplanImportVorschau> {
  return apiUpload<SchichtplanImportVorschau>(
    `${basis(einsatzId)}/import/vorschau`,
    einleseDaten(datei, entscheidungen),
    { timeoutMs: EINLESEN_TIMEOUT_MS },
  );
}

/**
 * Schichtplan einlesen, Übernehmen: dieselbe Datei und die Wahl aus der Vorschau, alles oder
 * nichts. Fehler sind 422 mit Zeilen, ein neuer Posten ohne Freigabe seines Moduls 403.
 */
export function schichtplanEinlesen(
  einsatzId: number,
  datei: File,
  entscheidungen: SchichtplanEntscheidungenEingabe,
): Promise<SchichtplanImportErgebnis> {
  return apiUpload<SchichtplanImportErgebnis>(
    `${basis(einsatzId)}/import`,
    einleseDaten(datei, entscheidungen),
    { timeoutMs: EINLESEN_TIMEOUT_MS },
  );
}

/** Zeit für das Schreiben einer großen Mappe (bis 2.000 Schichten). */
const MAPPE_TIMEOUT_MS = 60_000;

/**
 * Der Schichtplan als Excel-Mappe (LLH-1557): Austausch, Übersicht, Je Posten, Je Person,
 * Befunde. Ohne Freigabe des Moduls Personal 403. Der Server schickt keinen Dateinamen.
 */
export function ladeSchichtplanMappe(einsatzId: number): Promise<Blob> {
  return apiDatei(`${basis(einsatzId)}/export`, { timeoutMs: MAPPE_TIMEOUT_MS });
}
