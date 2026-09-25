import type { DemoDatenStatus } from './types';
import { apiGet, apiSend } from './client';

/**
 * Demo-Daten der eigenen Organisation (LFH-690, design.md D2/D3).
 *
 * Alle vier Endpunkte antworten mit demselben {@link DemoDatenStatus}, und zwar aus derselben
 * Transaktion wie der Vorgang selbst — nach einem Schreibaufruf ist ein zweiter Abruf also
 * nicht nötig, um zu wissen, wo man steht.
 *
 * Ohne `--demo-daten` am Backend sind die Routen nicht registriert: jeder Aufruf endet dann
 * in 404. Das ist KEIN Fehlerbild, sondern die Aussage „nicht freigeschaltet“ — es gibt dafür
 * bewusst keine zweite Quelle (kein Flag an `/api/karte/config` oder `/api/auth/me`).
 *
 * Statuscodes: GET 200 · POST 201 · POST `/neu` 200 · DELETE 200; 409 bei „schon importiert“
 * (POST) bzw. „nichts importiert“ (DELETE), 422 bei fehlendem Katalogeintrag, 401/403 wie
 * überall. Alle Fehler kommen als {@link ApiError} mit dem Servertext.
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
