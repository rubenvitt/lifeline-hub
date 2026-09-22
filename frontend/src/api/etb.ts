import type {
  Auftrag,
  EtbEintragAnzeige,
  EtbLesemarke,
  EtbTyp,
  EtbZaehler,
  MeldeWeg,
  NeuerAuftrag,
} from './types';
import { apiGet, apiSend, type ApiSendOptionen } from './client';

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

/**
 * Die Filtermerkmale als Query-Parameter. Liste UND Zählung bauen sie hier (LFH-612): der
 * Kopf zeigt „n Treffer", und n muss genau die Menge sein, die die Liste liefert — zwei
 * Abbildungen liefen beim ersten neuen Filterfeld still auseinander.
 */
function filterParameter(filter: EtbFilterWerte): URLSearchParams {
  const qs = new URLSearchParams();
  if (filter.q) qs.set('q', filter.q);
  if (filter.typ) qs.set('typ', filter.typ);
  if (filter.von) qs.set('von', filter.von);
  if (filter.bis) qs.set('bis', filter.bis);
  if (filter.erfasser_id != null) qs.set('erfasser_id', String(filter.erfasser_id));
  return qs;
}

export function listeEtb(einsatzId: number, params: EtbAbfrage = {}): Promise<EtbEintragAnzeige[]> {
  const qs = filterParameter(params);
  if (params.before_lfd_nr != null) qs.set('before_lfd_nr', String(params.before_lfd_nr));
  qs.set('limit', String(params.limit ?? SEITENGROESSE));
  return apiGet<EtbEintragAnzeige[]>(`/api/einsaetze/${einsatzId}/etb?${qs.toString()}`);
}

/** Exakte Zahl der Einträge gesamt und je Typ, über denselben Filter wie die Liste (LFH-612). */
export function ladeEtbZaehler(
  einsatzId: number,
  filter: EtbFilterWerte = {},
): Promise<EtbZaehler> {
  const qs = filterParameter(filter).toString();
  return apiGet<EtbZaehler>(`/api/einsaetze/${einsatzId}/etb/zaehler${qs ? `?${qs}` : ''}`);
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
  /** Client-generierte Idempotenz-UUID (F03/LFH-261). Stabil über Online-Direktsenden
   *  UND Offline-Enqueue+Flush, damit ein Retry keine Dublette erzeugt. */
  client_id?: string;
}

export function erfasseEtb(
  einsatzId: number,
  eintrag: NeuerEintrag,
  optionen?: ApiSendOptionen,
): Promise<EtbEintragAnzeige> {
  return apiSend<EtbEintragAnzeige>(`/api/einsaetze/${einsatzId}/etb`, 'POST', eintrag, optionen);
}

/** Aus einem ETB-Eintrag direkt einen Auftrag erteilen (ETB→Auftrag, LFH-112).
 *  Legt den Auftrag an und setzt `auftrag.quell_etb_eintrag_id` auf den Quell-Eintrag;
 *  liefert den erzeugten Auftrag zurück. */
export function erteileAuftragAusEtb(
  einsatzId: number,
  eintragId: number,
  daten: NeuerAuftrag,
): Promise<Auftrag> {
  return apiSend<Auftrag>(`/api/einsaetze/${einsatzId}/etb/${eintragId}/auftrag`, 'POST', daten);
}

/** Eigener Lesestand im Tagebuch (LFH-611): Marke, letzte Sichtung, fremde Einträge darüber. */
export function ladeEtbLesemarke(einsatzId: number): Promise<EtbLesemarke> {
  return apiGet<EtbLesemarke>(`/api/einsaetze/${einsatzId}/etb/lesemarke`);
}

/**
 * „Alle als gesichtet markieren" (LFH-611). `bisLfdNr` ist `hoechste_lfd_nr` der zuletzt
 * gelesenen Lesemarke — markiert wird, was das Banner angesagt hat, nicht was zwischen
 * Anzeige und Klick eintraf. Der Server rückt nur vorwärts.
 */
export function setzeEtbLesemarke(einsatzId: number, bisLfdNr: number): Promise<EtbLesemarke> {
  return apiSend<EtbLesemarke>(`/api/einsaetze/${einsatzId}/etb/lesemarke`, 'POST', {
    bis_lfd_nr: bisLfdNr,
  });
}
