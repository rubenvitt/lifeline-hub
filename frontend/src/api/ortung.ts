import type { EinsatzFahrzeug } from './types';
import type { components } from './types.generated';
import { apiGet, apiSend } from './client';

/** Kandidatenliste samt Auskunft, ob die Bestätigung „Besatzung ehrenamtlich“ Pflicht ist. */
export type TrackingCandidates = components['schemas']['TrackingCandidates'];

/** Eine Kennung der letzten 24 Stunden, ohne Koordinaten (LLH-2091). */
export type TrackingCandidate = components['schemas']['TrackingCandidate'];

/**
 * Body von `PUT …/tracking`. Nicht aus der OpenAPI erzeugt (der Handler liest ihn mit `JsonBody`),
 * deshalb hier gespiegelt: `volunteer_crew_confirmed` ist Pflicht, solange der Org-Schalter
 * `ortung_hauptamt` aus ist; der Server prüft es (422 mit `grund: "volunteer_crew_required"`).
 */
export interface OrtungKopplungBody {
  access_id: string;
  device_id: string;
  volunteer_crew_confirmed: boolean;
}

/** `grund` der 422, wenn die ehrenamtliche Besatzung nicht bestätigt wurde. */
export const GRUND_EHRENAMT_ERFORDERLICH = 'volunteer_crew_required';

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
