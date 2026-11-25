import type { EinsatzFahrzeug } from './types';
import type { components } from './types.generated';
import { apiGet, apiSend } from './client';

/** Kandidatenliste samt Org-Schalter „Ortung im Einsatz“ (`tracking_enabled`, ADR-0101). */
export type TrackingCandidates = components['schemas']['TrackingCandidates'];

/** Eine Kennung der letzten 24 Stunden, ohne Koordinaten (LLH-2091). */
export type TrackingCandidate = components['schemas']['TrackingCandidate'];

/**
 * Body von `PUT …/tracking`. Nicht aus der OpenAPI erzeugt (der Handler liest ihn mit `JsonBody`),
 * deshalb hier gespiegelt. Mit ausgeschaltetem Org-Schalter „Ortung im Einsatz“ antwortet der
 * Server 422.
 */
export interface OrtungKopplungBody {
  access_id: string;
  device_id: string;
}

function trackingPfad(einsatzId: number, efId: number): string {
  return `/api/incidents/${einsatzId}/vehicles/${efId}/tracking`;
}

/** Kennungen der letzten 24 Stunden zum Koppeln (nur mit Einsatzschreibrecht, ohne Koordinaten). */
export function listOrtungKandidaten(einsatzId: number, efId: number): Promise<TrackingCandidates> {
  return apiGet<TrackingCandidates>(`${trackingPfad(einsatzId, efId)}/candidates`);
}

/** Fahrzeug an eine Kennung koppeln; die Antwort ist das Fahrzeug mit der vorhandenen Position. */
export function koppleOrtung(
  einsatzId: number,
  efId: number,
  body: OrtungKopplungBody,
): Promise<EinsatzFahrzeug> {
  return apiSend<EinsatzFahrzeug>(trackingPfad(einsatzId, efId), 'PUT', body);
}

/** Kopplung lösen; die Position bleibt am Fahrzeug stehen. */
export function trenneOrtung(einsatzId: number, efId: number): Promise<void> {
  return apiSend<void>(trackingPfad(einsatzId, efId), 'DELETE');
}
