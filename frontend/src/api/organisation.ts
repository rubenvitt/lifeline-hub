import { apiGet, apiSend } from './client';
import type { OrganisationInfo } from './types';

/** L‑2: Lädt die Organisations-Stammdaten inkl. taktischer Default-Organisation. */
export function ladeOrganisation(): Promise<OrganisationInfo> {
  return apiGet<OrganisationInfo>('/api/organisation');
}

/** L‑2: Setzt die taktische Default-Organisation für Verortungen. */
export function setzeOrgDefault(tz_organisation: string): Promise<OrganisationInfo> {
  return apiSend<OrganisationInfo>('/api/organisation', 'PATCH', { tz_organisation });
}
