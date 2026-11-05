import type { EinheitTyp, QualiSollEingabe } from './types';
import { katalogApi } from './katalogApi';

export interface TypEingabe {
  label: string;
  soll_fuehrer?: number | null;
  soll_unterfuehrer?: number | null;
  soll_mannschaft?: number | null;
  sortier: number;
  /** Qualifikationssoll (LLH-1553); `[]` = keins. */
  quali_soll?: QualiSollEingabe[] | null;
}

const api = katalogApi<EinheitTyp, TypEingabe>('/api/einheit-typen');

export const listeEinheitTypen = api.liste;
export const legeTypAn = api.legeAn;
export const aktualisiereTyp = api.aktualisiere;
export const deaktiviereTyp = api.deaktiviere;
