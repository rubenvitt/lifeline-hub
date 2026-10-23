import { apiGet, apiSend, mitParametern } from './client';
import type { BenachrichtigungAnzeige, BenachrichtigungVerlauf } from './types';

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

/**
 * Der Verlauf eines Einsatzes für den Knopf „Eingänge“ (LLH-1143, design.md D3): die jüngsten
 * eigenen Benachrichtigungen mit Text und die Zahl der ungelesenen Eingänge darunter.
 */
export function ladeBenachrichtigungVerlauf(einsatzId: number): Promise<BenachrichtigungVerlauf> {
  return apiGet<BenachrichtigungVerlauf>(`/api/einsaetze/${einsatzId}/benachrichtigungen`);
}

/**
 * „Alle gelesen“ (design.md D4): alles bis einschließlich `bisId` außer Alarmen. Der Server meldet
 * es den anderen Tabs mit einem Ereignis samt `gelesen_bis`.
 */
export function markiereBenachrichtigungenGelesen(einsatzId: number, bisId: number): Promise<void> {
  return apiSend<void>(`/api/einsaetze/${einsatzId}/benachrichtigungen/gelesen`, 'POST', {
    bis_id: bisId,
  });
}
