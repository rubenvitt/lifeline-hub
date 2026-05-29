import type { Schaden, SchadenStatus, SchadenTyp, Ausmass } from './types';
import { apiGet, apiSend } from './client';

/** Felder beim Anlegen (Typ + Ort + Ausmaß Pflicht; Rest optional). Geschädigt FK XOR Freitext. */
export interface SchadenEingabe {
  typ: SchadenTyp;
  ausmass: Ausmass;
  ort: string;
  beschreibung?: string | null;
  geschaedigt_person_id?: number | null;
  geschaedigt_kontakt?: string | null;
}

/** Patch-Felder (nur Stammfelder + Audit-Felder; NICHT Status). Geschädigt-/Übergabe-Felder
 *  akzeptieren `null` = leeren (Toggle). */
export interface SchadenPatch {
  typ?: SchadenTyp;
  ausmass?: Ausmass;
  ort?: string;
  beschreibung?: string;
  geschaedigt_person_id?: number | null;
  geschaedigt_kontakt?: string | null;
  uebergeben_an?: string | null;
  abschluss_grund?: string | null;
}

export interface SchaedenFilter {
  status?: SchadenStatus;
  typ?: SchadenTyp;
  ausmass?: Ausmass;
  geschaedigtPersonId?: number;
  inklStorniert?: boolean;
}

export function listeSchaeden(einsatzId: number, filter: SchaedenFilter = {}): Promise<Schaden[]> {
  const params = new URLSearchParams();
  if (filter.status) params.set('status', filter.status);
  if (filter.typ) params.set('typ', filter.typ);
  if (filter.ausmass) params.set('ausmass', filter.ausmass);
  if (filter.geschaedigtPersonId != null) params.set('geschaedigt_person_id', String(filter.geschaedigtPersonId));
  if (filter.inklStorniert) params.set('inkl_storniert', 'true');
  const q = params.toString();
  return apiGet<Schaden[]>(`/api/einsaetze/${einsatzId}/schaeden${q ? `?${q}` : ''}`);
}

export function ladeSchaden(einsatzId: number, schadenId: number): Promise<Schaden> {
  return apiGet<Schaden>(`/api/einsaetze/${einsatzId}/schaeden/${schadenId}`);
}

export function legeSchadenAn(einsatzId: number, daten: SchadenEingabe): Promise<Schaden> {
  return apiSend<Schaden>(`/api/einsaetze/${einsatzId}/schaeden`, 'POST', daten);
}

export function aktualisiereSchaden(einsatzId: number, schadenId: number, daten: SchadenPatch): Promise<Schaden> {
  return apiSend<Schaden>(`/api/einsaetze/${einsatzId}/schaeden/${schadenId}`, 'PATCH', daten);
}

export function uebergebeSchaden(einsatzId: number, schadenId: number, uebergeben_an: string): Promise<Schaden> {
  return apiSend<Schaden>(`/api/einsaetze/${einsatzId}/schaeden/${schadenId}/uebergeben`, 'POST', { uebergeben_an });
}

export function schliesseSchadenAb(
  einsatzId: number,
  schadenId: number,
  abschluss_grund: string,
  notiz?: string,
): Promise<Schaden> {
  return apiSend<Schaden>(`/api/einsaetze/${einsatzId}/schaeden/${schadenId}/abschliessen`, 'POST', {
    abschluss_grund,
    notiz: notiz ?? null,
  });
}

export function storniereSchaden(einsatzId: number, schadenId: number): Promise<void> {
  return apiSend<void>(`/api/einsaetze/${einsatzId}/schaeden/${schadenId}`, 'DELETE');
}

/** Registriernummer-Anzeige wie im Backend (S-007). */
export function schadenRegistrierAnzeige(nr: number): string {
  return `S-${String(nr).padStart(3, '0')}`;
}
