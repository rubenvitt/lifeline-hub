import { apiGet, apiSend } from './client';
import type { UnterkunftRichtwerte } from './types';

/**
 * Richtwerte des Unterkunftsrechners (LLH-1520, design.md D2): Basis, Org- und Einsatz-Werte je
 * Schlüssel mit dem wirksamen Wert und seiner Herkunft. Bezeichnung, Einheit und Quelle liest die
 * Oberfläche aus der Basis-Datei (`betreuung/unterkunft/richtwerte.ts`).
 */

/** Basis und Werte der eigenen Organisation. */
export function ladeOrgUnterkunftRichtwerte(): Promise<UnterkunftRichtwerte> {
  return apiGet<UnterkunftRichtwerte>('/api/unterkunft-richtwerte');
}

/** Org-Wert setzen, `null` = zurück zur Vorgabe (nur System-Admin). */
export function setzeOrgUnterkunftRichtwert(
  schluessel: string,
  wert: number | null,
): Promise<UnterkunftRichtwerte> {
  return apiSend<UnterkunftRichtwerte>(
    `/api/org-unterkunft-richtwerte/${encodeURIComponent(schluessel)}`,
    'PUT',
    { wert },
  );
}

/** Alle Ebenen im Einsatz. */
export function ladeEinsatzUnterkunftRichtwerte(einsatzId: number): Promise<UnterkunftRichtwerte> {
  return apiGet<UnterkunftRichtwerte>(`/api/einsaetze/${einsatzId}/unterkunft-richtwerte`);
}

/** Einsatz-Wert setzen, `null` = erbt (Verwaltungszugriff des Einsatzes). */
export function setzeEinsatzUnterkunftRichtwert(
  einsatzId: number,
  schluessel: string,
  wert: number | null,
): Promise<UnterkunftRichtwerte> {
  return apiSend<UnterkunftRichtwerte>(
    `/api/einsaetze/${einsatzId}/unterkunft-richtwerte/${encodeURIComponent(schluessel)}`,
    'PUT',
    { wert },
  );
}
