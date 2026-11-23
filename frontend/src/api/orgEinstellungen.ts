import type {
  OrgEinstellungen,
  OrgEinstellungenUpdate,
  OrgModulEinstellungen,
  OrgModulEinstellungUpdate,
} from './types';
import { apiGet, apiSend } from './client';

/** Org-weite Einstellungen laden (GET /api/org-settings).
 *  Berechtigung: admin oder fuehrungskraft. */
export function ladeOrgEinstellungen(): Promise<OrgEinstellungen> {
  return apiGet<OrgEinstellungen>('/api/org-settings');
}

/** Org-weite Einstellungen setzen (PUT /api/org-settings, Vollersatz).
 *  Berechtigung: nur system_rolle=admin (sonst 403). */
export function speichereOrgEinstellungen(
  update: OrgEinstellungenUpdate,
): Promise<OrgEinstellungen> {
  return apiSend<OrgEinstellungen>('/api/org-settings', 'PUT', update);
}

/** Alle Modul-Vorgaben laden (GET /api/org-module-settings).
 *  Berechtigung: admin oder fuehrungskraft.
 *  Antwort: sparse Map — fehlt ein Key = keine Vorgabe (sichtbar, frei). */
export function ladeOrgModulEinstellungen(): Promise<OrgModulEinstellungen> {
  return apiGet<OrgModulEinstellungen>('/api/org-module-settings');
}

/** Vorgabe für ein Modul setzen (PUT /api/org-module-settings/:modulKey).
 *  Berechtigung: nur system_rolle=admin (sonst 403).
 *  `benoetigte_rolle = null` = kein Rollen-Zwang (frei); `sichtbar = false` blendet das Modul für
 *  alle Einsätze ohne eigenen Wert aus (LLH-1179). */
export function setzeOrgModulEinstellung(
  modulKey: string,
  vorgabe: OrgModulEinstellungUpdate,
): Promise<void> {
  return apiSend<void>(`/api/org-module-settings/${modulKey}`, 'PUT', vorgabe);
}
