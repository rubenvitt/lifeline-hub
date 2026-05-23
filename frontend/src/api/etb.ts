import type { EtbEintragAnzeige, EtbTyp, MeldeWeg } from './types';
import { apiGet, apiSend } from './client';

export const SEITENGROESSE = 100;

export interface EtbFilterWerte {
  q?: string;
  typ?: EtbTyp;
  von?: string;
  bis?: string;
  erfasser_id?: number;
}

export interface EtbAbfrage extends EtbFilterWerte {
  before_lfd_nr?: number;
  limit?: number;
}

export function listeEtb(einsatzId: number, params: EtbAbfrage = {}): Promise<EtbEintragAnzeige[]> {
  const qs = new URLSearchParams();
  if (params.q) qs.set('q', params.q);
  if (params.typ) qs.set('typ', params.typ);
  if (params.von) qs.set('von', params.von);
  if (params.bis) qs.set('bis', params.bis);
  if (params.erfasser_id != null) qs.set('erfasser_id', String(params.erfasser_id));
  if (params.before_lfd_nr != null) qs.set('before_lfd_nr', String(params.before_lfd_nr));
  qs.set('limit', String(params.limit ?? SEITENGROESSE));
  return apiGet<EtbEintragAnzeige[]>(`/api/einsaetze/${einsatzId}/etb?${qs.toString()}`);
}

export interface NeuerEintrag {
  typ: EtbTyp;
  inhalt: string;
  von?: string;
  an?: string;
  meldeweg?: MeldeWeg;
  veranlassung?: string;
  ereigniszeit?: string;
  erfasst_lokal_at?: string;
  berichtigt_eintrag_id?: number;
}

export function erfasseEtb(einsatzId: number, eintrag: NeuerEintrag): Promise<EtbEintragAnzeige> {
  return apiSend<EtbEintragAnzeige>(`/api/einsaetze/${einsatzId}/etb`, 'POST', eintrag);
}
