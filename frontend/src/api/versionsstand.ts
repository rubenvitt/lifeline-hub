import type { VersionsstandAnzeige } from './types';
import { apiGet, apiSend } from './client';

/**
 * Laufende Version des Servers, die zuletzt gestartete und der Lesestand der Neuigkeiten
 * (GET /api/versionsstand). Der Stand gilt für die ganze Instanz, nicht für die Person.
 */
export function ladeVersionsstand(): Promise<VersionsstandAnzeige> {
  return apiGet<VersionsstandAnzeige>('/api/versionsstand');
}

/**
 * Die laufende Version als gelesen markieren (POST /api/versionsstand/gelesen). Aufgerufen beim
 * Öffnen der Neuigkeiten-Seite und beim Schließen der Hinweiskarte.
 */
export function markiereNeuigkeitenGelesen(): Promise<VersionsstandAnzeige> {
  return apiSend<VersionsstandAnzeige>('/api/versionsstand/gelesen', 'POST');
}
