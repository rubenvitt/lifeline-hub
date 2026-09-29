import type { EinheitTyp } from './types';
import { katalogApi } from './katalogApi';

export interface TypEingabe {
  label: string;
  soll_fuehrer?: number | null;
  soll_unterfuehrer?: number | null;
  soll_mannschaft?: number | null;
  sortier: number;
}

const api = katalogApi<EinheitTyp, TypEingabe>('/api/einheit-typen');

export const listeEinheitTypen = api.liste;
export const legeTypAn = api.legeAn;
export const aktualisiereTyp = api.aktualisiere;
export const deaktiviereTyp = api.deaktiviere;
