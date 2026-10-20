import { apiGet, apiSend, type ApiSendOptionen } from './client';
import type {
  BezirkMeldung,
  EvakuierungUebersicht,
  Evakuierungsbezirk,
  EvakuierungsbezirkEingabe,
  EvakuierungsbezirkPatch,
  StandVerlaufEintrag,
  StandmeldungEingabe,
} from './types';

/**
 * Fachmodul Evakuierung (LLH-1034): Evakuierungsbezirke mit Standmeldungen. Bis LLH-1034 lagen die
 * Routen unter `…/betreuung`; die Tabellen teilt das Modul weiter mit der Betreuung. Zeiten gehen
 * als UTC `YYYY-MM-DD HH:mm:ss` auf den Draht, hin über `alsBackendZeit`, zurück über
 * `alsZeitpunkt` (`anzeige/zeitEingabe.ts`), nie über `dayjs(s)`.
 */
const basis = (einsatzId: number) => `/api/einsaetze/${einsatzId}/evakuierung`;

/** Die eine Lesequelle: alle nicht stornierten Bezirke samt aktuellem Stand. */
export function ladeEvakuierung(einsatzId: number): Promise<EvakuierungUebersicht> {
  return apiGet<EvakuierungUebersicht>(basis(einsatzId));
}

/**
 * Standreihe eines Bezirks samt zurückgenommener Meldungen, in der Ordnung, in der der Server
 * „aktuell“ bestimmt (jüngster Zeitpunkt zuerst). Fremder/unbekannter Bezirk: 404.
 */
export function ladeStandVerlauf(
  einsatzId: number,
  bezirkId: number,
): Promise<StandVerlaufEintrag[]> {
  return apiGet<StandVerlaufEintrag[]>(`${basis(einsatzId)}/bezirke/${bezirkId}/staende`);
}

export function legeBezirkAn(
  einsatzId: number,
  body: EvakuierungsbezirkEingabe,
): Promise<Evakuierungsbezirk> {
  return apiSend<Evakuierungsbezirk>(`${basis(einsatzId)}/bezirke`, 'POST', body);
}

export function aendereBezirk(
  einsatzId: number,
  bezirkId: number,
  body: EvakuierungsbezirkPatch,
): Promise<Evakuierungsbezirk> {
  return apiSend<Evakuierungsbezirk>(`${basis(einsatzId)}/bezirke/${bezirkId}`, 'PATCH', body);
}

/** Unumkehrbar (Fehlanlage); ein zweites Stornieren ist 409. */
export function storniereBezirk(einsatzId: number, bezirkId: number): Promise<Evakuierungsbezirk> {
  return apiSend<Evakuierungsbezirk>(
    `${basis(einsatzId)}/bezirke/${bezirkId}/stornieren`,
    'POST',
    {},
  );
}

/**
 * Mit `client_id` idempotent: ein Replay liefert die gespeicherte Meldung. Die Offline-Queue
 * speichert keine URL, nur Bezirk und Body; ein vor LLH-1034 eingereihter Stand geht beim
 * Nachsenden deshalb ebenfalls hierhin.
 */
export function meldeStand(
  einsatzId: number,
  bezirkId: number,
  body: StandmeldungEingabe,
  optionen?: ApiSendOptionen,
): Promise<BezirkMeldung> {
  return apiSend<BezirkMeldung>(
    `${basis(einsatzId)}/bezirke/${bezirkId}/staende`,
    'POST',
    body,
    optionen,
  );
}

/** Rückweg einer Standmeldung; `standId` ist `BezirkMeldung.meldung_id`. Zweimal → 422. */
export function nimmStandZurueck(einsatzId: number, standId: number): Promise<BezirkMeldung> {
  return apiSend<BezirkMeldung>(`${basis(einsatzId)}/staende/${standId}/zuruecknehmen`, 'POST', {});
}
