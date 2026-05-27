import type { Person, PersonStatus, PersonZugriff } from './types';
import { apiGet, apiSend } from './client';

/** Felder, die beim Anlegen/Bearbeiten gesetzt werden können (alle optional). */
export interface PersonEingabe {
  name?: string | null;
  vorname?: string | null;
  geschlecht?: string | null;
  geburtsdatum?: string | null;
  alter_geschaetzt?: number | null;
  herkunft_adresse?: string | null;
  antreff_ort?: string | null;
  melder_kontakt?: string | null;
  notiz?: string | null;
}

export function listePersonen(einsatzId: number, status?: PersonStatus): Promise<Person[]> {
  const q = status ? `?status=${status}` : '';
  return apiGet<Person[]>(`/api/einsaetze/${einsatzId}/personen${q}`);
}

export function ladePerson(einsatzId: number, personId: number): Promise<Person> {
  // Schreibt serverseitig einen detail-Audit-Eintrag.
  return apiGet<Person>(`/api/einsaetze/${einsatzId}/personen/${personId}`);
}

export function legePersonAn(einsatzId: number, daten: PersonEingabe): Promise<Person> {
  return apiSend<Person>(`/api/einsaetze/${einsatzId}/personen`, 'POST', daten);
}

export function aktualisierePerson(einsatzId: number, personId: number, daten: PersonEingabe): Promise<Person> {
  return apiSend<Person>(`/api/einsaetze/${einsatzId}/personen/${personId}`, 'PATCH', daten);
}

export function setzePersonStatus(einsatzId: number, personId: number, status: PersonStatus): Promise<Person> {
  return apiSend<Person>(`/api/einsaetze/${einsatzId}/personen/${personId}/status`, 'POST', { status });
}

export function stornierePerson(einsatzId: number, personId: number): Promise<void> {
  return apiSend<void>(`/api/einsaetze/${einsatzId}/personen/${personId}`, 'DELETE');
}

export function ladePersonAudit(einsatzId: number, personId: number): Promise<PersonZugriff[]> {
  return apiGet<PersonZugriff[]>(`/api/einsaetze/${einsatzId}/personen/${personId}/audit`);
}

/** Registriernummer-Anzeige wie im Backend (R-042). */
export function registrierAnzeige(nr: number): string {
  return `R-${String(nr).padStart(3, '0')}`;
}
