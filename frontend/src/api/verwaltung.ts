import type { Bereitschaft } from './types';
import { apiGet } from './client';

/**
 * Bestand der Bereitschaft für die Übersicht der Verwaltung (LLH-1820). Nur Zahlen; gewertet wird
 * in `admin/bereitschaft.ts`. 403 ohne Zugang zur Verwaltung.
 */
export function loadBereitschaft(): Promise<Bereitschaft> {
  return apiGet<Bereitschaft>('/api/verwaltung/bereitschaft');
}
