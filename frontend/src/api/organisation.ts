import { apiGet, apiSend, apiUpload } from './client';
import type { OrganisationInfo } from './types';

const PFAD = '/api/organisation';
const LOGO_PFAD = `${PFAD}/logo`;

/** L‑2: Lädt die Organisations-Stammdaten inkl. taktischer Default-Organisation und Logo. */
export function ladeOrganisation(): Promise<OrganisationInfo> {
  return apiGet<OrganisationInfo>(PFAD);
}

/** Änderbare Felder der Organisation; was fehlt, bleibt auf dem Server unverändert. */
export interface OrganisationAenderung {
  name?: string;
  tz_organisation?: string;
}

/**
 * Ändert Name (LFH-22, nur Admin) und/oder DV-102-Organisation (L‑2) in EINEM PATCH (LFH-979).
 * Schickt nur die übergebenen Felder: der PATCH nimmt beide optional, ein mitgeschicktes Feld
 * überschriebe einen inzwischen fremd geänderten Stand.
 */
export function aendereOrganisation(felder: OrganisationAenderung): Promise<OrganisationInfo> {
  const body: OrganisationAenderung = {};
  if (felder.name !== undefined) body.name = felder.name;
  if (felder.tz_organisation !== undefined) body.tz_organisation = felder.tz_organisation;
  return apiSend<OrganisationInfo>(PFAD, 'PATCH', body);
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
