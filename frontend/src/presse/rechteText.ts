import type { EinsatzStatus } from '../api/types';
import { einsatzRechteGrund } from '../components/nurAnsicht';

/**
 * Grund der fehlenden Berechtigung auf den S5-Seiten (LFH-554, M16): gesperrt bleibt sichtbar,
 * die Zeile „Nur Ansicht · Grund“ nennt ihn in wenigen Wörtern (LFH-1078).
 */
export function presseRechteText(einsatzStatus: EinsatzStatus): string {
  return einsatzRechteGrund(einsatzStatus);
}

export function infotelefonRechteText(einsatzStatus: EinsatzStatus): string {
  return einsatzRechteGrund(einsatzStatus);
}

/** Grund an der gesperrten Freigabe einer Pressemitteilung; Entwürfe bleiben schreibbar. */
export const FREIGABE_NUR_LEITUNG = 'Freigabe nur durch die Einsatzleitung';
