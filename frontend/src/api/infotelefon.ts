import { apiGet, apiSend, mitParametern } from './client';
import type { AbschlussCursor } from './meldungen';
import type {
  InfotelefonAnliegen,
  InfotelefonAnruf,
  InfotelefonStatus,
  InfotelefonZaehler,
} from './types';

/**
 * Informationstelefon S5 (LFH-554): Anrufprotokoll unter dem Stab. Name, Rückrufnummer und
 * Notiz sind personenbezogen; sie erscheinen in keiner Ableitung (Medienlage, Lagebericht).
 *
 * Seit LLH-732 ist die Liste immer geblättert, und alle Zahlen kommen aus `…/zaehler` über den
 * ganzen Bestand, nie aus den geladenen Seiten.
 */
const pfad = (einsatzId: number) => `/api/einsaetze/${einsatzId}/stab/infotelefon`;

/** Seitengröße der Anrufliste; der Server klemmt auf seine Obergrenze. */
export const ANRUFE_PAGE_SIZE = 100;

/** Position hinter dem letzten geladenen Anruf: Eingang und Kennung (`vor_zeit`, `vor_id`). */
export function anrufCursor(a: Pick<InfotelefonAnruf, 'id' | 'eingang_at'>): AbschlussCursor {
  return { zeit: a.eingang_at, id: a.id };
}

interface AnrufPageOptions {
  /** Fehlt = alle Anrufe. */
  status?: InfotelefonStatus;
  vor?: AbschlussCursor;
  limit?: number;
}

/** Eine Seite des Protokolls, jüngster Eingang zuerst (Ordnung vom Server). */
export function loadAnrufe(
  einsatzId: number,
  { status, vor, limit = ANRUFE_PAGE_SIZE }: AnrufPageOptions = {},
): Promise<InfotelefonAnruf[]> {
  return apiGet<InfotelefonAnruf[]>(
    mitParametern(pfad(einsatzId), { status, vor_zeit: vor?.zeit, vor_id: vor?.id, limit }),
  );
}

/** Zahlen über den ganzen Bestand: gesamt, offene Rückrufe, je Anliegen (LLH-732). */
export function loadAnrufZaehler(einsatzId: number): Promise<InfotelefonZaehler> {
  return apiGet<InfotelefonZaehler>(`${pfad(einsatzId)}/zaehler`);
}

/** Ein Anruf, für den Deeplink auf eine nicht geladene Zeile (404 bei fremdem Einsatz). */
export function loadAnruf(einsatzId: number, anrufId: number): Promise<InfotelefonAnruf> {
  return apiGet<InfotelefonAnruf>(`${pfad(einsatzId)}/${anrufId}`);
}

/** Kein Backend-Schema: Eingabe-Body von `POST …/stab/infotelefon`. */
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
