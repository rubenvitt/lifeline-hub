import { apiGet } from './client';
import type { LagemonitorAnzeige } from './types';

/** Verdichtetes Lagebild des Lagemonitors (LFH-892): nur für eine Gerätesitzung dieser Ansicht. */
export function ladeLagemonitor(einsatzId: number): Promise<LagemonitorAnzeige> {
  return apiGet<LagemonitorAnzeige>(`/api/einsaetze/${einsatzId}/lagemonitor`);
}
