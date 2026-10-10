import type { DatentraegerStatus } from './types';
import { apiGet } from './client';

/**
 * Zustand des Server-Rechners (LFH-1100). Nur für den System-Admin; jede andere Rolle bekommt
 * 403, anonym 401.
 */

/** `GET /api/system/datentraeger` — letztes Ergebnis der Datenträgerprüfung. */
export function ladeDatentraegerStatus(): Promise<DatentraegerStatus> {
  return apiGet<DatentraegerStatus>('/api/system/datentraeger');
}
