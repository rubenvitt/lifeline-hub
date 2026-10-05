import type { UhsPlatz } from './types';
import type { components } from './types.generated';
import { apiSend, apiUploadMitFortschritt, type UploadFortschritt } from './client';
import { UPLOAD_TIMEOUT_MS } from './upload';

/**
 * Plan einer UHS als Hintergrund des Platz-Layouts (LFH-999). Eigene Bytes, kein Anhang: die
 * Anzeige schreibt kein Zugriffsprotokoll, nur die Übernahme aus den Dateien tut es einmal
 * (`openspec/changes/archive/2026-10-05-lfh-999-uhs-plan-hintergrund/design.md`, D1/D4).
 */
export type UhsPlan = components['schemas']['UhsPlanAnzeige'];

/** Lage und Darstellung; der Server rastet `x/y/breite` auf 10 px ein. */
export interface PlanPatch {
  x?: number;
  y?: number;
  breite?: number;
  helligkeit?: number;
  kontrast?: number;
  nacht_umkehren?: boolean;
}

const basis = (einsatzId: number, uhsId: number) => `/api/einsaetze/${einsatzId}/uhs/${uhsId}/plan`;

/** Bild-Route: ohne Audit, mit ETag. Ein API-Pfad, keine Navigation. */
export function planBildPfad(einsatzId: number, uhsId: number): string {
  return `${basis(einsatzId, uhsId)}/bild`;
}

/** Lädt die Bild-Bytes (same-origin, mit Cookies) als Object-URL. Freigegeben wird sie, wenn die
 *  Query den Cache verlässt (`erzeugeQueryClient`). */
export async function ladePlanBild(einsatzId: number, uhsId: number): Promise<string> {
  const res = await fetch(planBildPfad(einsatzId, uhsId), {
    credentials: 'same-origin',
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Plan konnte nicht geladen werden (${res.status})`);
  return URL.createObjectURL(await res.blob());
}

/** Hinterlegt oder ersetzt den Plan (PUT, Feld `datei`); Ersetzen behält Lage und Darstellung. */
export function hinterlegePlan(
  einsatzId: number,
  uhsId: number,
  datei: File,
  onFortschritt?: (stand: UploadFortschritt) => void,
): Promise<UhsPlan> {
  const fd = new FormData();
  fd.append('datei', datei);
  return apiUploadMitFortschritt<UhsPlan>(basis(einsatzId, uhsId), fd, {
    methode: 'PUT',
    timeoutMs: UPLOAD_TIMEOUT_MS,
    onFortschritt,
  });
}

/** Macht einen Bild-Anhang dieser UHS zum Plan; der Server protokolliert das als einen Abruf. */
export function uebernehmePlan(
  einsatzId: number,
  uhsId: number,
  anhangId: number,
): Promise<UhsPlan> {
  return apiSend<UhsPlan>(`${basis(einsatzId, uhsId)}/aus-anhang`, 'POST', {
    anhang_id: anhangId,
  });
}

export function aenderePlan(einsatzId: number, uhsId: number, patch: PlanPatch): Promise<UhsPlan> {
  return apiSend<UhsPlan>(basis(einsatzId, uhsId), 'PATCH', patch);
}

export function entfernePlan(einsatzId: number, uhsId: number): Promise<void> {
  return apiSend<void>(basis(einsatzId, uhsId), 'DELETE');
}

// Konstanten von `src/uhs/plan.rs` (D5): Raster, Kartengröße, Rand und Grenzen.
const RASTER = 10;
const KARTE_BREITE = 140;
const KARTE_HOEHE = 116;
const EINPASS_RAND = 20;
const BREITE_OHNE_PLAETZE = 820;
const BREITE_MIN = 100;
const BREITE_MAX = 5000;
const VERSATZ_MAX = 10_000;

/** Vom Plan erlaubte Breiten in Pixeln der Platzfläche (Zahlenfeld im Bedienfeld). */
export const PLAN_BREITE = { min: BREITE_MIN, max: BREITE_MAX, schritt: RASTER } as const;
export const PLAN_VERSATZ_MAX = VERSATZ_MAX;

/**
 * „An Plätze einpassen“ (D5a), dieselbe Rechnung wie `startlage` im Server: Rahmen aller Plätze
 * plus 20 px Rand, der Plan überdeckt ihn ganz (größerer Faktor) und sitzt oben links am Rahmen.
 * Ohne Plätze 0/0/820. Stornierte und unplatzierte Plätze zählen wie dort nicht.
 */
export function einpassen(
  plaetze: readonly UhsPlatz[],
  bildBreite: number,
  bildHoehe: number,
): { x: number; y: number; breite: number } {
  const lagen = plaetze.filter(
    (p) => p.storniert_at == null && p.pos_x != null && p.pos_y != null,
  ) as (UhsPlatz & { pos_x: number; pos_y: number })[];
  if (lagen.length === 0) return { x: 0, y: 0, breite: BREITE_OHNE_PLAETZE };
  const xs = lagen.map((p) => p.pos_x);
  const ys = lagen.map((p) => p.pos_y);
  const ab = (v: number) => Math.min(Math.floor(Math.max(0, v) / RASTER) * RASTER, VERSATZ_MAX);
  const x = ab(Math.min(...xs) - EINPASS_RAND);
  const y = ab(Math.min(...ys) - EINPASS_RAND);
  const rahmenB = Math.max(...xs) + KARTE_BREITE + EINPASS_RAND - x;
  const rahmenH = Math.max(...ys) + KARTE_HOEHE + EINPASS_RAND - y;
  const noetig = Math.max(rahmenB, (rahmenH * bildBreite) / bildHoehe);
  const breite = Math.min(Math.max(Math.ceil(noetig / RASTER) * RASTER, BREITE_MIN), BREITE_MAX);
  return { x, y, breite };
}
