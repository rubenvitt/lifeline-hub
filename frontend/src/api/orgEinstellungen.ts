import type { OrgEinstellungen, OrgEinstellungenUpdate, OrgModulEinstellungen } from './types';
import { apiGet, apiSend } from './client';

/** Org-weite Einstellungen laden (GET /api/org-einstellungen).
 *  Berechtigung: admin oder fuehrungskraft. */
export function ladeOrgEinstellungen(): Promise<OrgEinstellungen> {
  return apiGet<OrgEinstellungen>('/api/org-einstellungen');
}

/** Org-weite Einstellungen setzen (PUT /api/org-einstellungen, Vollersatz).
 *  Berechtigung: nur system_rolle=admin (sonst 403). */
export function speichereOrgEinstellungen(
  update: OrgEinstellungenUpdate,
): Promise<OrgEinstellungen> {
  return apiSend<OrgEinstellungen>('/api/org-einstellungen', 'PUT', update);
}

/** Alle Modul-Rollen-Defaults laden (GET /api/org-modul-einstellungen).
 *  Berechtigung: admin oder fuehrungskraft.
 *  Antwort: sparse Map — fehlt ein Key = kein Org-Default (frei). */
export function ladeOrgModulEinstellungen(): Promise<OrgModulEinstellungen> {
  return apiGet<OrgModulEinstellungen>('/api/org-modul-einstellungen');
}

/** Rollen-Default für ein Modul setzen (PUT /api/org-modul-einstellungen/:modulKey, 204).
 *  Berechtigung: nur system_rolle=admin (sonst 403).
 *  `rolle = null` = kein Rollen-Zwang (frei). */
export function setzeOrgModulEinstellung(
  modulKey: string,
  rolle: 'admin' | 'fuehrungskraft' | null,
): Promise<void> {
  return apiSend<void>(
    `/api/org-modul-einstellungen/${modulKey}`,
    'PUT',
    { benoetigte_rolle: rolle },
  );
}
