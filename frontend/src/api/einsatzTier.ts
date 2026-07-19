import type { Tier, TierStatus, Spezies } from './types';
import { apiGet, apiSend } from './client';

/** Felder beim Anlegen (Spezies Pflicht; Rest optional). Halter FK XOR Freitext. */
export interface TierEingabe {
  status?: 'aktiv' | 'vermisst';
  spezies: Spezies;
  rasse_beschreibung?: string | null;
  rufname?: string | null;
  geschlecht?: string | null;
  alter_geschaetzt?: number | null;
  farbe_beschreibung?: string | null;
  kennzeichnung?: string | null;
  groesse_gewicht?: string | null;
  halter_person_id?: number | null;
  halter_kontakt?: string | null;
  antreff_ort?: string | null;
  notiz?: string | null;
}

/** Patch-Felder. Halter-Felder akzeptieren `null` = leeren (FK↔Freitext-Toggle). */
export interface TierPatch {
  rasse_beschreibung?: string | null;
  rufname?: string | null;
  geschlecht?: string | null;
  alter_geschaetzt?: number | null;
  farbe_beschreibung?: string | null;
  kennzeichnung?: string | null;
  groesse_gewicht?: string | null;
  antreff_ort?: string | null;
  notiz?: string | null;
  halter_person_id?: number | null;
  halter_kontakt?: string | null;
}

export interface TierStatusEingabe {
  status: TierStatus;
  abschluss_grund?: string | null;
  abschluss_ziel?: string | null;
}

export interface TiereFilter {
  status?: TierStatus;
  spezies?: Spezies;
  halterPersonId?: number;
}

export function listeTiere(einsatzId: number, filter: TiereFilter = {}): Promise<Tier[]> {
  const params = new URLSearchParams();
  if (filter.status) params.set('status', filter.status);
  if (filter.spezies) params.set('spezies', filter.spezies);
  if (filter.halterPersonId != null) params.set('halter_person_id', String(filter.halterPersonId));
  const q = params.toString();
  return apiGet<Tier[]>(`/api/einsaetze/${einsatzId}/tiere${q ? `?${q}` : ''}`);
}

export function ladeTier(einsatzId: number, tierId: number): Promise<Tier> {
  return apiGet<Tier>(`/api/einsaetze/${einsatzId}/tiere/${tierId}`);
}

export function legeTierAn(einsatzId: number, daten: TierEingabe): Promise<Tier> {
  return apiSend<Tier>(`/api/einsaetze/${einsatzId}/tiere`, 'POST', daten);
}

/**
 * Optimistisches Lock (LFH-299/F10): `basisGeaendertAt` trägt den beim Laden gelesenen
 * `geaendert_at`-Stand. Ist er veraltet → 409 statt stillem Overwrite. Ohne Baseline
 * (Halter-Zuordnung aus der Personen-Detailseite, Konfliktdialog-Overwrite) wird bewusst
 * blind geschrieben.
 */
export function aktualisiereTier(
  einsatzId: number,
  tierId: number,
  daten: TierPatch,
  basisGeaendertAt?: string,
): Promise<Tier> {
  const body = basisGeaendertAt ? { ...daten, basis_geaendert_at: basisGeaendertAt } : daten;
  return apiSend<Tier>(`/api/einsaetze/${einsatzId}/tiere/${tierId}`, 'PATCH', body);
}

export function setzeTierStatus(einsatzId: number, tierId: number, daten: TierStatusEingabe): Promise<Tier> {
  return apiSend<Tier>(`/api/einsaetze/${einsatzId}/tiere/${tierId}/status`, 'POST', daten);
}

export function storniereTier(einsatzId: number, tierId: number): Promise<void> {
  return apiSend<void>(`/api/einsaetze/${einsatzId}/tiere/${tierId}`, 'DELETE');
}

/** Registriernummer-Anzeige wie im Backend (T-042). */
export function tierRegistrierAnzeige(nr: number): string {
  return `T-${String(nr).padStart(3, '0')}`;
}
