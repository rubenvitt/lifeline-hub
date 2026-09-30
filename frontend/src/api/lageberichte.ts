import { apiGet, apiSend } from './client';
import type { LageberichtAbschnitt, LageberichtAnzeige, LageberichtVorlageKey } from './types';

export function listeLageberichte(einsatzId: number): Promise<LageberichtAnzeige[]> {
  return apiGet<LageberichtAnzeige[]>(`/api/einsaetze/${einsatzId}/lageberichte`);
}

export function ladeLagebericht(einsatzId: number, id: number): Promise<LageberichtAnzeige> {
  return apiGet<LageberichtAnzeige>(`/api/einsaetze/${einsatzId}/lageberichte/${id}`);
}

interface NeuerLagebericht {
  vorlage: LageberichtVorlageKey;
  titel: string;
  zeitstand?: string;
  /**
   * Startinhalt (LFH-548): der Entwurf entsteht in EINEM Aufruf mit Text. Jeder Schlüssel gehört
   * zur Vorlage und steht höchstens einmal da, sonst 400 ohne Entwurf.
   */
  abschnitte?: LageberichtAbschnitt[];
}

export function legeLageberichtAn(
  einsatzId: number,
  daten: NeuerLagebericht,
): Promise<LageberichtAnzeige> {
  return apiSend<LageberichtAnzeige>(`/api/einsaetze/${einsatzId}/lageberichte`, 'POST', daten);
}

interface LageberichtPatch {
  titel?: string;
  zeitstand?: string;
  abschnitte?: LageberichtAbschnitt[];
}

export function aktualisiereLagebericht(
  einsatzId: number,
  id: number,
  patch: LageberichtPatch,
): Promise<LageberichtAnzeige> {
  return apiSend<LageberichtAnzeige>(
    `/api/einsaetze/${einsatzId}/lageberichte/${id}`,
    'PATCH',
    patch,
  );
}

export function gibLageberichtFrei(einsatzId: number, id: number): Promise<LageberichtAnzeige> {
  return apiSend<LageberichtAnzeige>(
    `/api/einsaetze/${einsatzId}/lageberichte/${id}/freigeben`,
    'POST',
  );
}

export function schreibeLageberichtFort(
  einsatzId: number,
  id: number,
  zeitstand?: string,
): Promise<LageberichtAnzeige> {
  return apiSend<LageberichtAnzeige>(
    `/api/einsaetze/${einsatzId}/lageberichte/${id}/fortschreiben`,
    'POST',
    { zeitstand },
  );
}
