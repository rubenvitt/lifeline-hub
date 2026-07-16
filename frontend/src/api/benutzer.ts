import type { BenutzerAnzeige, OrgRolle, SystemRolle } from './types';
import { apiGet, apiSend } from './client';

export function listeBenutzer(): Promise<BenutzerAnzeige[]> {
  return apiGet<BenutzerAnzeige[]>('/api/benutzer');
}

export interface NeuerBenutzer {
  anzeigename: string;
  benutzername: string;
  passwort: string;
  system_rolle?: SystemRolle;
  org_rolle?: OrgRolle;
}

export function legeBenutzerAn(b: NeuerBenutzer): Promise<BenutzerAnzeige> {
  return apiSend<BenutzerAnzeige>('/api/benutzer', 'POST', b);
}

export function deaktiviereBenutzer(id: number): Promise<BenutzerAnzeige> {
  return apiSend<BenutzerAnzeige>(`/api/benutzer/${id}/deaktivieren`, 'POST');
}

/** Partielle Änderung eines bestehenden Benutzers (LFH-286). Nur gesetzte Felder ändern sich. */
export interface PatchBenutzer {
  anzeigename?: string;
  system_rolle?: SystemRolle;
  org_rolle?: OrgRolle;
  aktiv?: boolean;
}

export function bearbeiteBenutzer(id: number, patch: PatchBenutzer): Promise<BenutzerAnzeige> {
  return apiSend<BenutzerAnzeige>(`/api/benutzer/${id}`, 'PATCH', patch);
}
