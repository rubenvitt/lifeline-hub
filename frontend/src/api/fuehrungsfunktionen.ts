import { apiGet, apiSend } from './client';
import type { FuehrungsfunktionEintrag, Fuehrungsfunktion, FuehrungsfunktionUpdate } from './types';

/** Wirksamer Katalog der eigenen Organisation (LFH-549); S7 nur, wenn eingeschaltet. */
export function ladeFuehrungsfunktionen(): Promise<FuehrungsfunktionEintrag[]> {
  return apiGet<FuehrungsfunktionEintrag[]>('/api/fuehrungsfunktionen');
}

/** Label bzw. S7-Schalter setzen (nur System-Admin); liefert den neuen wirksamen Katalog. */
export function setzeFuehrungsfunktion(
  funktion: Fuehrungsfunktion,
  daten: FuehrungsfunktionUpdate,
): Promise<FuehrungsfunktionEintrag[]> {
  return apiSend<FuehrungsfunktionEintrag[]>(
    `/api/org-fuehrungsfunktionen/${funktion}`,
    'PUT',
    daten,
  );
}
