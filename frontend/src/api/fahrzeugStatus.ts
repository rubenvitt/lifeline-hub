import type { FahrzeugStatus, StatusKategorie } from './types';
import { katalogApi } from './katalogApi';

export interface StatusEingabe {
  label: string;
  kategorie: StatusKategorie;
  farbe: string | null;
  fms_anker: number | null;
  sortier: number;
}

const api = katalogApi<FahrzeugStatus, StatusEingabe>('/api/fahrzeug-status');

export const listeFahrzeugStatus = api.liste;
export const legeStatusAn = api.legeAn;
export const aktualisiereStatus = api.aktualisiere;
export const deaktiviereStatus = api.deaktiviere;
