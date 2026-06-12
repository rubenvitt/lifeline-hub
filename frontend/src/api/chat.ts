import { apiGet, apiSend } from './client';
import type { ChatKanal, ChatNachricht, EtbTyp, NeuerAuftrag } from './types';


export function listeKanaele(einsatzId: number): Promise<ChatKanal[]> {
  return apiGet<ChatKanal[]>(`/api/einsaetze/${einsatzId}/chat/kanaele`);
}

export interface NeuerKanal {
  name: string;
  beschreibung?: string;
}

export function legeKanalAn(einsatzId: number, daten: NeuerKanal): Promise<ChatKanal> {
  return apiSend<ChatKanal>(`/api/einsaetze/${einsatzId}/chat/kanaele`, 'POST', daten);
}

export function listeNachrichten(
  einsatzId: number,
  kanalId: number,
  beforeId?: number,
): Promise<ChatNachricht[]> {
  const q = beforeId !== undefined ? `?before_id=${beforeId}` : '';
  return apiGet<ChatNachricht[]>(`/api/einsaetze/${einsatzId}/chat/kanaele/${kanalId}/nachrichten${q}`);
}

export function sendeNachricht(einsatzId: number, kanalId: number, inhalt: string): Promise<ChatNachricht> {
  return apiSend<ChatNachricht>(
    `/api/einsaetze/${einsatzId}/chat/kanaele/${kanalId}/nachrichten`, 'POST', { inhalt },
  );
}

export function bearbeiteNachricht(einsatzId: number, nachrichtId: number, inhalt: string): Promise<ChatNachricht> {
  return apiSend<ChatNachricht>(`/api/einsaetze/${einsatzId}/chat/nachrichten/${nachrichtId}`, 'PATCH', { inhalt });
}

export function loescheNachricht(einsatzId: number, nachrichtId: number): Promise<void> {
  return apiSend<void>(`/api/einsaetze/${einsatzId}/chat/nachrichten/${nachrichtId}`, 'DELETE');
}

export function heraufstufenZuEtb(
  einsatzId: number,
  nachrichtId: number,
  typ: EtbTyp,
  inhalt: string,
): Promise<ChatNachricht> {
  return apiSend<ChatNachricht>(
    `/api/einsaetze/${einsatzId}/chat/nachrichten/${nachrichtId}/heraufstufen-etb`, 'POST', { typ, inhalt },
  );
}

/** Stuft eine Nachricht zu einem Auftrag herauf (LFH-101); legt den Auftrag an und
 *  liefert die markierte Nachricht zurück. */
export function heraufstufenZuAuftrag(
  einsatzId: number,
  nachrichtId: number,
  daten: NeuerAuftrag,
): Promise<ChatNachricht> {
  return apiSend<ChatNachricht>(
    `/api/einsaetze/${einsatzId}/chat/nachrichten/${nachrichtId}/heraufstufen-auftrag`, 'POST', daten,
  );
}
