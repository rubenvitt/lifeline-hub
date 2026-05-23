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
