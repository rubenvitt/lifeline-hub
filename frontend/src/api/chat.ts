import { apiGet, apiSend, apiUpload } from './client';
import type { Anhang, ChatKanal, ChatNachricht, EtbTyp, NeuerAuftrag } from './types';


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

/** Seitengröße der Nachrichten-Pagination. Muss dem Backend-Default (STANDARD_LIMIT,
 *  src/routes/chat.rs) entsprechen, damit die hasNextPage-Heuristik (volle Seite = mehr da)
 *  greift — das Frontend sendet kein eigenes limit. */
export const CHAT_SEITENGROESSE = 100;

export function listeNachrichten(
  einsatzId: number,
  kanalId: number,
  beforeId?: number,
): Promise<ChatNachricht[]> {
  const q = beforeId !== undefined ? `?before_id=${beforeId}` : '';
  return apiGet<ChatNachricht[]>(`/api/einsaetze/${einsatzId}/chat/kanaele/${kanalId}/nachrichten${q}`);
}

/** Lädt Dateien hoch und liefert die Anhang-Metadaten zurück (LFH-102). Der
 *  Upload ist von der Nachricht entkoppelt: erst hochladen, dann beim Senden die
 *  `anhang_ids` mitgeben. */
export function ladeAnhaengeHoch(einsatzId: number, dateien: File[]): Promise<Anhang[]> {
  const formData = new FormData();
  for (const datei of dateien) formData.append('datei', datei);
  return apiUpload<Anhang[]>(`/api/einsaetze/${einsatzId}/anhaenge`, formData);
}

export function sendeNachricht(
  einsatzId: number,
  kanalId: number,
  inhalt: string,
  anhangIds: number[] = [],
): Promise<ChatNachricht> {
  return apiSend<ChatNachricht>(
    `/api/einsaetze/${einsatzId}/chat/kanaele/${kanalId}/nachrichten`,
    'POST',
    { inhalt, anhang_ids: anhangIds },
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
