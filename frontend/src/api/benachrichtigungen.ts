import { apiGet, apiSend, mitParametern } from './client';
import type { BenachrichtigungAnzeige } from './types';

/**
 * Eine eigene Benachrichtigung mit Text (`GET /api/benachrichtigungen/{id}`). Eine fremde oder
 * aufgeräumte antwortet 404: der Aufrufer zeigt dann nichts.
 */
export function ladeBenachrichtigung(id: number): Promise<BenachrichtigungAnzeige> {
  return apiGet<BenachrichtigungAnzeige>(`/api/benachrichtigungen/${id}`);
}

/**
 * Die offenen eigenen Benachrichtigungen der letzten zwölf Stunden, jüngste zuerst. Grundlage
 * des Nachreichens (design.md D5): nach `lagged`, nach einem Neuaufbau und beim Öffnen eines
 * Einsatzes.
 */
export function ladeOffeneBenachrichtigungen(): Promise<BenachrichtigungAnzeige[]> {
  return apiGet<BenachrichtigungAnzeige[]>(
    mitParametern('/api/benachrichtigungen', { offen: true }),
  );
}

/** Quittiert eine eigene Benachrichtigung; idempotent. Der Server meldet es allen Verbindungen. */
export function quittiereBenachrichtigung(id: number): Promise<void> {
  return apiSend<void>(`/api/benachrichtigungen/${id}/quittieren`, 'POST');
}
