import type { ArchivEmpfaengerAnzeige, NeuerArchivEmpfaenger } from './types';
import { apiGet, apiSend } from './client';

// Archiv-Schlüssel der Organisation (LLH-1494): öffentliche age-Schlüssel, an die der Hub einen
// Einsatz am Ende der Nachbereitung verschlüsselt. Nur der System-Admin; ein Schlüssel gilt erst
// nach der Probe (Code aus der verschlüsselten Probe).

const BASIS = '/api/org-archiv-schluessel';

export function ladeArchivSchluessel(): Promise<ArchivEmpfaengerAnzeige[]> {
  return apiGet<ArchivEmpfaengerAnzeige[]>(BASIS);
}

/** Trägt einen Schlüssel ein; die Antwort trägt die Probe (age, ASCII-Armor). */
export function trageArchivSchluesselEin(
  schluessel: string,
  bezeichnung: string,
): Promise<NeuerArchivEmpfaenger> {
  return apiSend<NeuerArchivEmpfaenger>(BASIS, 'POST', { schluessel, bezeichnung });
}

export function pruefeArchivSchluessel(id: number, code: string): Promise<ArchivEmpfaengerAnzeige> {
  return apiSend<ArchivEmpfaengerAnzeige>(`${BASIS}/${id}/pruefen`, 'POST', { code });
}

export function entferneArchivSchluessel(id: number): Promise<void> {
  return apiSend<void>(`${BASIS}/${id}`, 'DELETE');
}
