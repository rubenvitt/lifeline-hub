import type { ZeitachseMarke, PersonalStatus, StatusKategorie } from './types';
import { katalogApi } from './katalogApi';

export interface StatusEingabe {
  label: string;
  kategorie: StatusKategorie;
  farbe: string | null;
  sortier: number;
  /** LFH-552: fehlt = unverändert, `null` = Marke entfernen. */
  zeitachse_marke?: ZeitachseMarke | null;
}

const api = katalogApi<PersonalStatus, StatusEingabe>('/api/personal-status');

export const listePersonalStatus = api.liste;
export const legeStatusAn = api.legeAn;
export const aktualisiereStatus = api.aktualisiere;
export const deaktiviereStatus = api.deaktiviere;
