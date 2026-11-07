import type { DemoDatenStatus, DemoLage } from './types';
import { apiGet, apiSend } from './client';

/**
 * Demo-Daten der eigenen Organisation (LFH-690), je Lage (LLH-1576). Alle Endpunkte antworten
 * mit demselben {@link DemoDatenStatus} über ALLE Lagen aus derselben Transaktion wie der
 * Vorgang; ein zweiter Abruf ist nicht nötig. Eine unbekannte Lage im Pfad ist 404.
 *
 * Ohne `--demo-daten` am Backend sind die Routen nicht registriert: 404 heißt „nicht
 * freigeschaltet“, es gibt dafür bewusst keine zweite Quelle.
 *
 * Statuscodes: GET 200 · POST 201 · POST `/neu` 200 · DELETE 200; 409 bei „schon importiert“
 * (POST) bzw. „nichts importiert“ (DELETE), 422 bei fehlendem Katalogeintrag. Fehler kommen als
 * {@link ApiError} mit dem Servertext.
 */

const PFAD = '/api/demo-daten';

/** `GET /api/demo-daten` — Stand aller Lagen; 404 ohne Freischaltung. */
export function ladeDemoDatenStatus(): Promise<DemoDatenStatus> {
  return apiGet<DemoDatenStatus>(PFAD);
}

/** `POST /api/demo-daten/{lage}` — erstmaliger Import der Lage; 409, wenn sie schon importiert
 *  ist. Die andere Lage bleibt unberührt (LLH-1576). */
export function importiereDemoDaten(lage: DemoLage): Promise<DemoDatenStatus> {
  return apiSend<DemoDatenStatus>(`${PFAD}/${lage}`, 'POST');
}

/** `POST /api/demo-daten/{lage}/neu` — ersetzt den aktiven Import der Lage in EINER
 *  Transaktion; ohne aktiven Import ist es ein erstmaliger Import. */
export function importiereDemoDatenNeu(lage: DemoLage): Promise<DemoDatenStatus> {
  return apiSend<DemoDatenStatus>(`${PFAD}/${lage}/neu`, 'POST');
}

/** `DELETE /api/demo-daten/{lage}` — entfernt den Demo-Einsatz der Lage und ihre unbenutzten
 *  Demo-Stammdaten; 409, wenn die Lage nicht importiert ist. */
export function entferneDemoDaten(lage: DemoLage): Promise<DemoDatenStatus> {
  return apiSend<DemoDatenStatus>(`${PFAD}/${lage}`, 'DELETE');
}
