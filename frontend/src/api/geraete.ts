import type {
  Funktionsansicht,
  GeraetAnzeige,
  GeraeteUebersicht,
  KopplungAnzeige,
  KopplungMitCode,
} from './types';
import { apiGet, apiSend } from './client';

// Gerätekopplung (LFH-892): Verwaltung durch die Einsatzleitung und Einlösen des Codes.
// Herleitung: `openspec/changes/lfh-892-funktionsansichten-geraete/design.md` (D3).

export function ladeGeraete(einsatzId: number): Promise<GeraeteUebersicht> {
  return apiGet<GeraeteUebersicht>(`/api/einsaetze/${einsatzId}/geraete`);
}

/** Anlegefelder einer Kopplung. `uhs_id` genau bei den stellengebundenen Ansichten. Ohne
 *  `laeuft_ab_at` gilt die Vorgabe des Servers (24 Stunden). */
export interface NeueKopplung {
  ansicht: Funktionsansicht;
  uhs_id: number | null;
  bezeichnung: string;
  /** UTC ohne Zone (`alsBackendZeit`). */
  laeuft_ab_at?: string;
}

export function legeKopplungAn(einsatzId: number, daten: NeueKopplung): Promise<KopplungMitCode> {
  return apiSend<KopplungMitCode>(`/api/einsaetze/${einsatzId}/geraete`, 'POST', daten);
}

/** Neuer Code für eine bestehende Kopplung; beim Einlösen enden die alten Sitzungen. */
export function stelleCodeAus(einsatzId: number, kopplungId: number): Promise<KopplungMitCode> {
  return apiSend<KopplungMitCode>(`/api/einsaetze/${einsatzId}/geraete/${kopplungId}/code`, 'POST');
}

export function verlaengereKopplung(
  einsatzId: number,
  kopplungId: number,
  laeuftAbAt: string,
): Promise<KopplungAnzeige> {
  return apiSend<KopplungAnzeige>(
    `/api/einsaetze/${einsatzId}/geraete/${kopplungId}/verlaengern`,
    'POST',
    { laeuft_ab_at: laeuftAbAt },
  );
}

export function widerrufeKopplung(einsatzId: number, kopplungId: number): Promise<KopplungAnzeige> {
  return apiSend<KopplungAnzeige>(
    `/api/einsaetze/${einsatzId}/geraete/${kopplungId}/widerrufen`,
    'POST',
  );
}

/** Löst einen Kopplungscode ein; der Server setzt dabei das Sitzungscookie des Geräts. */
export function koppeln(code: string): Promise<GeraetAnzeige> {
  return apiSend<GeraetAnzeige>('/api/geraete/koppeln', 'POST', { code });
}
