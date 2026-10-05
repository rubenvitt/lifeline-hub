import type { Tier, TierAnhang, TierStatus, Spezies } from './types';
import {
  apiDatei,
  apiGet,
  apiSend,
  apiUploadMitFortschritt,
  mitParametern,
  type UploadFortschritt,
} from './client';
import { UPLOAD_TIMEOUT_MS } from './upload';
import { EXPORT_TIMEOUT_MS } from './exportTimeout';
import { patchBody } from './patchTriState';
import { registrierNummer } from '../anzeige/registrierNummer';

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

/** Patch-Felder. JEDES Feld akzeptiert `null` = leeren; ein fehlender Key lässt es unverändert. */
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

interface TierStatusEingabe {
  status: TierStatus;
  abschluss_grund?: string | null;
  abschluss_ziel?: string | null;
}

interface TiereFilter {
  status?: TierStatus;
  spezies?: Spezies;
  halterPersonId?: number;
}

export function listeTiere(einsatzId: number, filter: TiereFilter = {}): Promise<Tier[]> {
  return apiGet<Tier[]>(
    mitParametern(`/api/einsaetze/${einsatzId}/tiere`, {
      status: filter.status,
      spezies: filter.spezies,
      halter_person_id: filter.halterPersonId,
    }),
  );
}

/** CSV aller nicht stornierten Tiere des Einsatzes (`routes/einsatz_tier.rs`, `export`). */
export function ladeTiereExport(einsatzId: number): Promise<Blob> {
  return apiDatei(`/api/einsaetze/${einsatzId}/tiere/export`, { timeoutMs: EXPORT_TIMEOUT_MS });
}

export function ladeTier(einsatzId: number, tierId: number): Promise<Tier> {
  return apiGet<Tier>(`/api/einsaetze/${einsatzId}/tiere/${tierId}`);
}

export function legeTierAn(einsatzId: number, daten: TierEingabe): Promise<Tier> {
  return apiSend<Tier>(`/api/einsaetze/${einsatzId}/tiere`, 'POST', daten);
}

/**
 * Optimistisches Lock: `basisGeaendertAt` trägt den beim Laden gelesenen `geaendert_at`-Stand;
 * veraltet → 409. Ohne Baseline (Halter-Zuordnung aus der Personen-Detailseite,
 * Konfliktdialog-Overwrite) wird bewusst blind geschrieben.
 *
 * `daten` wird mit der FORMULAR-Lesart normalisiert (`undefined` = leeren, siehe
 * `api/patchTriState.ts`), nur über VORHANDENE Keys: `PersonenDetailPage` ruft mit Partials aus
 * den Halter-Feldern auf. Wer aus einem Spread patcht, baut das Objekt vorher mit
 * `nurGesetzteFelder`.
 */
export function aktualisiereTier(
  einsatzId: number,
  tierId: number,
  daten: TierPatch,
  basisGeaendertAt?: string,
): Promise<Tier> {
  const body = patchBody(daten, basisGeaendertAt);
  return apiSend<Tier>(`/api/einsaetze/${einsatzId}/tiere/${tierId}`, 'PATCH', body);
}

export function setzeTierStatus(
  einsatzId: number,
  tierId: number,
  daten: TierStatusEingabe,
): Promise<Tier> {
  return apiSend<Tier>(`/api/einsaetze/${einsatzId}/tiere/${tierId}/status`, 'POST', daten);
}

export function storniereTier(einsatzId: number, tierId: number): Promise<void> {
  return apiSend<void>(`/api/einsaetze/${einsatzId}/tiere/${tierId}`, 'DELETE');
}

/** Registriernummer-Anzeige wie im Backend (T-042). */
export function tierRegistrierAnzeige(nr: number): string {
  return registrierNummer('T', nr);
}

// ---------- Fotos und Dateien (LFH-758) ----------

const anhangBasis = (einsatzId: number, tierId: number) =>
  `/api/einsaetze/${einsatzId}/tiere/${tierId}/anhaenge`;

/** Lebende Anhänge eines Tieres, neueste zuerst. */
export function listeTierAnhaenge(einsatzId: number, tierId: number): Promise<TierAnhang[]> {
  return apiGet<TierAnhang[]>(anhangBasis(einsatzId, tierId));
}

/** Legt EINE Datei am Tier ab (Feld `datei`); Timeout und Fortschritt wie die übrigen Uploads. */
export function legeTierAnhangAb(
  einsatzId: number,
  tierId: number,
  datei: File,
  onFortschritt?: (stand: UploadFortschritt) => void,
): Promise<TierAnhang> {
  const fd = new FormData();
  fd.append('datei', datei);
  return apiUploadMitFortschritt<TierAnhang>(anhangBasis(einsatzId, tierId), fd, {
    timeoutMs: UPLOAD_TIMEOUT_MS,
    onFortschritt,
  });
}

/** Entfernt einen Anhang (Soft-Delete mit ETB-Nachweis); `anhangId` ist die Linker-id. */
export function entferneTierAnhang(
  einsatzId: number,
  tierId: number,
  anhangId: number,
): Promise<void> {
  return apiSend<void>(`${anhangBasis(einsatzId, tierId)}/${anhangId}`, 'DELETE');
}

/**
 * Download über die modul-gegatete Tier-Route, nie über `/anhaenge/{aid}` des Einsatzes (dort
 * 404). Ein API-Pfad, keine Navigation, deshalb nicht in `routing/deeplinks.ts`.
 */
export function tierAnhangDownloadPfad(
  einsatzId: number,
  tierId: number,
  anhangId: number,
): string {
  return `${anhangBasis(einsatzId, tierId)}/${anhangId}/datei`;
}
