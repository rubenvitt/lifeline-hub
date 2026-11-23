import { apiGet, apiSend, mitParametern } from './client';
import type { AbschlussCursor } from './meldungen';
import {
  seitenLimit,
  type CursorAdapter,
  type FensterParam,
} from '../components/fensterBeideRichtungen';
import type {
  InfotelefonAnliegen,
  InfotelefonAnruf,
  InfotelefonStatus,
  InfotelefonZaehler,
} from './types';

/**
 * Informationstelefon (LFH-554): Anrufprotokoll, seit i6k6mzed ein eigenes Modul. Die Adresse
 * liegt unter `…/staff/info-line` (ADR-0093). Name, Rückrufnummer und
 * Notiz sind personenbezogen; sie erscheinen in keiner Ableitung (Lagebericht, Druck).
 *
 * Seit LLH-732 ist die Liste immer geblättert, und alle Zahlen kommen aus `…/zaehler` über den
 * ganzen Bestand, nie aus den geladenen Seiten.
 */
const pfad = (einsatzId: number) => `/api/einsaetze/${einsatzId}/staff/info-line`;

/** Seitengröße der Anrufliste; der Server klemmt auf seine Obergrenze. */
export const ANRUFE_PAGE_SIZE = 100;

/** Position hinter dem letzten geladenen Anruf: Eingang und Kennung (`vor_zeit`, `vor_id`). */
export function anrufCursor(a: Pick<InfotelefonAnruf, 'id' | 'eingang_at'>): AbschlussCursor {
  return { zeit: a.eingang_at, id: a.id };
}

/** Ordnung des Protokolls wie am Server: jüngster Eingang zuerst, Gleichstand über die Kennung. */
export function anrufOrdnung(
  a: Pick<InfotelefonAnruf, 'id' | 'eingang_at'>,
  b: Pick<InfotelefonAnruf, 'id' | 'eingang_at'>,
): number {
  if (a.eingang_at !== b.eingang_at) return a.eingang_at < b.eingang_at ? 1 : -1;
  return b.id - a.id;
}

/**
 * Cursor des Seitenfensters (LLH-1886, `components/fensterBeideRichtungen.ts`): Eingang und
 * Kennung, lexikografisch geordnet — `(zeit, id ± 1)` schließt den Anruf `(zeit, id)` ein.
 */
export const ANRUF_CURSOR: CursorAdapter<InfotelefonAnruf, AbschlussCursor> = {
  cursor: anrufCursor,
  einschliessendAelter: (c) => ({ zeit: c.zeit, id: c.id + 1 }),
  einschliessendNeuer: (c) => ({ zeit: c.zeit, id: c.id - 1 }),
};

interface AnrufPageOptions {
  /** Fehlt = alle Anrufe. */
  status?: InfotelefonStatus;
  /** Die Seite unter dem Cursor (älter). */
  vor?: AbschlussCursor;
  /** Die Seite direkt über dem Cursor (neuer, LLH-1886); nie zusammen mit `vor`. */
  nach?: AbschlussCursor;
  limit?: number;
}

/** Eine Seite des Protokolls, jüngster Eingang zuerst (Ordnung vom Server). */
export function loadAnrufe(
  einsatzId: number,
  { status, vor, nach, limit = ANRUFE_PAGE_SIZE }: AnrufPageOptions = {},
): Promise<InfotelefonAnruf[]> {
  return apiGet<InfotelefonAnruf[]>(
    mitParametern(pfad(einsatzId), {
      status,
      vor_zeit: vor?.zeit,
      vor_id: vor?.id,
      nach_zeit: nach?.zeit,
      nach_id: nach?.id,
      limit,
    }),
  );
}

/** Die Seitenoptionen eines Fensterparameters: Richtung und Größe (`seitenLimit`). */
export function anrufSeite(
  param: FensterParam<AbschlussCursor>,
): Pick<AnrufPageOptions, 'vor' | 'nach' | 'limit'> {
  const limit = seitenLimit(ANRUFE_PAGE_SIZE, param);
  if (param == null) return { limit };
  return 'aelter' in param ? { vor: param.aelter, limit } : { nach: param.neuer, limit };
}

/** Zahlen über den ganzen Bestand: gesamt, offene Rückrufe, je Anliegen (LLH-732). */
export function loadAnrufZaehler(einsatzId: number): Promise<InfotelefonZaehler> {
  return apiGet<InfotelefonZaehler>(`${pfad(einsatzId)}/counts`);
}

/** Ein Anruf, für den Deeplink auf eine nicht geladene Zeile (404 bei fremdem Einsatz). */
export function loadAnruf(einsatzId: number, anrufId: number): Promise<InfotelefonAnruf> {
  return apiGet<InfotelefonAnruf>(`${pfad(einsatzId)}/${anrufId}`);
}

/** Kein Backend-Schema: Eingabe-Body von `POST …/staff/info-line`. */
export interface AnrufEingabe {
  anliegen: InfotelefonAnliegen;
  notiz?: string;
  anrufer_name?: string;
  rueckruf?: string;
  /** Mit Rückruf beginnt der Anruf `offen` und braucht `rueckruf` (sonst 422). */
  rueckruf_noetig?: boolean;
  /** Fehlt = jetzt. */
  eingang_at?: string;
}

export function erfasseAnruf(einsatzId: number, body: AnrufEingabe): Promise<InfotelefonAnruf> {
  return apiSend<InfotelefonAnruf>(pfad(einsatzId), 'POST', body);
}

/** Rückruf erledigen oder wieder öffnen. */
export function setzeAnrufStatus(
  einsatzId: number,
  anrufId: number,
  status: InfotelefonStatus,
): Promise<InfotelefonAnruf> {
  return apiSend<InfotelefonAnruf>(`${pfad(einsatzId)}/${anrufId}/status`, 'POST', { status });
}
