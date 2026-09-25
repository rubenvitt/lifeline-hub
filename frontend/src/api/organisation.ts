import { apiGet, apiSend, apiUpload } from './client';
import type { OrganisationInfo } from './types';

const PFAD = '/api/organisation';
const LOGO_PFAD = `${PFAD}/logo`;

/** L‑2: Lädt die Organisations-Stammdaten inkl. taktischer Default-Organisation und Logo. */
export function ladeOrganisation(): Promise<OrganisationInfo> {
  return apiGet<OrganisationInfo>(PFAD);
}

/** L‑2: Setzt die taktische Default-Organisation für Verortungen. */
export function setzeOrgDefault(tz_organisation: string): Promise<OrganisationInfo> {
  return apiSend<OrganisationInfo>(PFAD, 'PATCH', { tz_organisation });
}

/**
 * Benennt die eigene Organisation um (LFH-22, nur Admin). Schickt NUR den Namen: der PATCH
 * nimmt beide Felder optional, ein mitgeschicktes `tz_organisation` überschriebe die Vorgabe.
 */
export function setzeOrgName(name: string): Promise<OrganisationInfo> {
  return apiSend<OrganisationInfo>(PFAD, 'PATCH', { name });
}

/**
 * Lädt das Logo der eigenen Organisation hoch oder ersetzt es (LFH-22, nur Admin).
 * PNG oder JPEG bis 1 MiB; maßgeblich prüft der Server. Die Frist liegt über dem Standard,
 * weil der Server vor dem Speichern bis zu 30 s auf den Virenscan wartet.
 */
export function ladeOrgLogoHoch(datei: File): Promise<OrganisationInfo> {
  const fd = new FormData();
  fd.append('datei', datei);
  return apiUpload<OrganisationInfo>(LOGO_PFAD, fd, { timeoutMs: 45_000 });
}

/** Entfernt das Logo der eigenen Organisation (LFH-22, nur Admin). Unumkehrbar. */
export function entferneOrgLogo(): Promise<void> {
  return apiSend<void>(LOGO_PFAD, 'DELETE');
}

/**
 * Adresse des Logos mit dem sha256 als Cache-Brecher: Die Adresse selbst ist stabil, der
 * Inhalt nicht. Ohne `v` käme ein ersetztes Logo im selben Dokument aus dem Bildspeicher.
 */
export function orgLogoPfad(sha256: string): string {
  return `${LOGO_PFAD}?v=${encodeURIComponent(sha256)}`;
}
