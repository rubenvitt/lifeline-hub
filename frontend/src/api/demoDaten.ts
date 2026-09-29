import type { DemoDatenStatus } from './types';
import { apiGet, apiSend } from './client';

/**
 * Demo-Daten der eigenen Organisation (LFH-690). Alle vier Endpunkte antworten mit demselben
 * {@link DemoDatenStatus} aus derselben Transaktion wie der Vorgang; ein zweiter Abruf ist nicht
 * nötig.
 *
 * Ohne `--demo-daten` am Backend sind die Routen nicht registriert: 404 heißt „nicht
 * freigeschaltet“, es gibt dafür bewusst keine zweite Quelle.
 *
 * Statuscodes: GET 200 · POST 201 · POST `/neu` 200 · DELETE 200; 409 bei „schon importiert“
 * (POST) bzw. „nichts importiert“ (DELETE), 422 bei fehlendem Katalogeintrag. Fehler kommen als
 * {@link ApiError} mit dem Servertext.
 */

const PFAD = '/api/demo-daten';

/** `GET /api/demo-daten` — Stand; 404 ohne Freischaltung. */
export function ladeDemoDatenStatus(): Promise<DemoDatenStatus> {
  return apiGet<DemoDatenStatus>(PFAD);
}

/** `POST /api/demo-daten` — erstmaliger Import; 409, wenn schon ein Import aktiv ist. */
export function importiereDemoDaten(): Promise<DemoDatenStatus> {
  return apiSend<DemoDatenStatus>(PFAD, 'POST');
}

/** `POST /api/demo-daten/neu` — ersetzt einen aktiven Import in EINER Transaktion; ohne
 *  aktiven Import ist es ein erstmaliger Import. */
export function importiereDemoDatenNeu(): Promise<DemoDatenStatus> {
  return apiSend<DemoDatenStatus>(`${PFAD}/neu`, 'POST');
}

/** `DELETE /api/demo-daten` — entfernt Demo-Einsatz und unbenutzte Demo-Stammdaten; 409,
 *  wenn nichts importiert ist. */
export function entferneDemoDaten(): Promise<DemoDatenStatus> {
  return apiSend<DemoDatenStatus>(PFAD, 'DELETE');
}
