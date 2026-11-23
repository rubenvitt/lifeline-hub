import { apiGet, apiSend, type ApiSendOptionen } from './client';
import type {
  BelegungKopfzahl,
  BelegungVerlaufEintrag,
  BelegungsmeldungEingabe,
  BetreuungUebersicht,
  Betreuungsstelle,
  BetreuungsstelleEingabe,
  BetreuungsstellePatch,
  StelleMeldung,
  StornoStand,
} from './types';

/**
 * Fachmodul Betreuung: Betreuungsstellen mit Belegungsmeldungen. Die Evakuierungsbezirke sind seit
 * LLH-1034 das eigene Modul Evakuierung (`api/evakuierung.ts`). Zeiten gehen als UTC `YYYY-MM-DD HH:mm:ss` auf den Draht, hin über
 * `alsBackendZeit`, zurück über `alsZeitpunkt` (`anzeige/zeitEingabe.ts`), nie über `dayjs(s)`.
 */
const basis = (einsatzId: number) => `/api/einsaetze/${einsatzId}/care`;

/** Die eine Lesequelle: alle nicht stornierten Stellen samt aktueller Meldung. */
export function ladeBetreuung(einsatzId: number): Promise<BetreuungUebersicht> {
  return apiGet<BetreuungUebersicht>(basis(einsatzId));
}

/**
 * Kopfzahl „in Betreuung“ zum Stichtag; ohne `zeitpunkt` gilt „jetzt“. Der Wert wird kodiert:
 * der Wire-String trägt ein Leerzeichen, ein Zonenversatz ein `+`, das roh als Leerzeichen
 * ankäme.
 */
export function ladeBelegungKopfzahl(
  einsatzId: number,
  zeitpunkt?: string,
): Promise<BelegungKopfzahl> {
  const query = zeitpunkt ? `?zeitpunkt=${encodeURIComponent(zeitpunkt)}` : '';
  return apiGet<BelegungKopfzahl>(`${basis(einsatzId)}/occupancy${query}`);
}

/**
 * Belegungsreihe einer Stelle samt zurückgenommener Meldungen, in der Ordnung, in der der Server
 * „aktuell“ bestimmt (jüngster Zeitpunkt zuerst). Fremde/unbekannte Stelle: 404.
 */
export function ladeBelegungVerlauf(
  einsatzId: number,
  stelleId: number,
): Promise<BelegungVerlaufEintrag[]> {
  return apiGet<BelegungVerlaufEintrag[]>(`${basis(einsatzId)}/positions/${stelleId}/occupancies`);
}

export function legeStelleAn(
  einsatzId: number,
  body: BetreuungsstelleEingabe,
): Promise<Betreuungsstelle> {
  return apiSend<Betreuungsstelle>(`${basis(einsatzId)}/positions`, 'POST', body);
}

export function aendereStelle(
  einsatzId: number,
  stelleId: number,
  body: BetreuungsstellePatch,
  /**
   * Werte beim Öffnen (Feld-CAS, LLH-1945): hat ein anderer eine dieser Angaben inzwischen
   * geändert, antwortet der Server 409 `veraltet`; ohne `erwartet` schreibt er ohne Vergleich.
   * Der Status trägt keinen Altwert, die Koordinate nur als Paar.
   */
  erwartet?: Partial<Omit<BetreuungsstellePatch, 'status'>>,
): Promise<Betreuungsstelle> {
  return apiSend<Betreuungsstelle>(
    `${basis(einsatzId)}/positions/${stelleId}`,
    'PATCH',
    erwartet ? { ...body, erwartet } : body,
  );
}

/**
 * Storno-Stand einer Stelle (LLH-1832, Spec `storno-sperre`): die Übersicht lässt stornierte Stellen
 * weg; fällt eine gesehene heraus, nennt dieser Abruf Wann und Wer.
 */
export function loadBetreuungsstelleStand(
  einsatzId: number,
  stelleId: number,
): Promise<StornoStand> {
  return apiGet<StornoStand>(`${basis(einsatzId)}/positions/${stelleId}/state`);
}

/** Unumkehrbar (Fehlanlage); ein zweites Stornieren ist 409. */
export function storniereStelle(einsatzId: number, stelleId: number): Promise<Betreuungsstelle> {
  return apiSend<Betreuungsstelle>(`${basis(einsatzId)}/positions/${stelleId}/annul`, 'POST', {});
}

/** An eine geschlossene Stelle ist 422 — außer für den Replay einer schon gespeicherten Meldung. */
export function meldeBelegung(
  einsatzId: number,
  stelleId: number,
  body: BelegungsmeldungEingabe,
  optionen?: ApiSendOptionen,
): Promise<StelleMeldung> {
  return apiSend<StelleMeldung>(
    `${basis(einsatzId)}/positions/${stelleId}/occupancies`,
    'POST',
    body,
    optionen,
  );
}

/** Rückweg einer Belegungsmeldung; `meldungId` ist `StelleMeldung.meldung_id`. */
export function nimmBelegungZurueck(einsatzId: number, meldungId: number): Promise<StelleMeldung> {
  return apiSend<StelleMeldung>(`${basis(einsatzId)}/occupancies/${meldungId}/undo`, 'POST', {});
}
