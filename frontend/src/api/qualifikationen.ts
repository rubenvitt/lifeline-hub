import type { Qualifikation } from './types';
import { katalogApi } from './katalogApi';

export interface QualifikationEingabe {
  label: string;
  sortier: number;
}

const api = katalogApi<Qualifikation, QualifikationEingabe>('/api/qualifikationen');

export const listeQualifikationen = api.liste;
export const legeQualifikationAn = api.legeAn;
export const aktualisiereQualifikation = api.aktualisiere;
export const deaktiviereQualifikation = api.deaktiviere;
