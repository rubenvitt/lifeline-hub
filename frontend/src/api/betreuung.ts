import { apiGet, apiSend, type ApiSendOptionen } from './client';
import type {
  BelegungKopfzahl,
  BelegungVerlaufEintrag,
  BelegungsmeldungEingabe,
  BetreuungUebersicht,
  Betreuungsstelle,
  BetreuungsstelleEingabe,
  BetreuungsstellePatch,
  BezirkMeldung,
  Evakuierungsbezirk,
  EvakuierungsbezirkEingabe,
  EvakuierungsbezirkPatch,
  StandVerlaufEintrag,
  StandmeldungEingabe,
  StelleMeldung,
} from './types';

/**
 * Fachmodul Betreuung (LFH-639): Evakuierungsbezirke mit Standmeldungen, Betreuungsstellen
 * mit Belegungsmeldungen. Zeiten gehen als UTC `YYYY-MM-DD HH:mm:ss` auf den Draht — hin über
 * `alsBackendZeit`, zurück über `alsOrtszeit` (`etb/filterZeit.ts`), nie über `dayjs(s)`
 * (design.md D2).
 */
const basis = (einsatzId: number) => `/api/einsaetze/${einsatzId}/betreuung`;

/** Die eine Lesequelle: alle nicht stornierten Bezirke und Stellen samt aktueller Meldung. */
export function ladeBetreuung(einsatzId: number): Promise<BetreuungUebersicht> {
  return apiGet<BetreuungUebersicht>(basis(einsatzId));
}

/**
 * Kopfzahl „in Betreuung" zum Stichtag (LFH-634); ohne `zeitpunkt` gilt „jetzt". Der Wert
 * wird kodiert: der Wire-String trägt ein Leerzeichen, ein Zonenversatz ein `+`, das roh als
 * Leerzeichen ankäme.
 */
export function ladeBelegungKopfzahl(
  einsatzId: number,
  zeitpunkt?: string,
): Promise<BelegungKopfzahl> {
  const query = zeitpunkt ? `?zeitpunkt=${encodeURIComponent(zeitpunkt)}` : '';
  return apiGet<BelegungKopfzahl>(`${basis(einsatzId)}/belegung${query}`);
}

/**
 * Standreihe eines Bezirks samt zurückgenommener Meldungen (LFH-676), in der Ordnung, in der
 * der Server „aktuell“ bestimmt (jüngster Zeitpunkt zuerst). Fremder/unbekannter Bezirk: 404.
 */
export function ladeStandVerlauf(
  einsatzId: number,
  bezirkId: number,
): Promise<StandVerlaufEintrag[]> {
  return apiGet<StandVerlaufEintrag[]>(`${basis(einsatzId)}/bezirke/${bezirkId}/staende`);
}

/** Belegungsreihe einer Stelle (LFH-676), wie {@link ladeStandVerlauf}. */
export function ladeBelegungVerlauf(
  einsatzId: number,
  stelleId: number,
): Promise<BelegungVerlaufEintrag[]> {
  return apiGet<BelegungVerlaufEintrag[]>(`${basis(einsatzId)}/stellen/${stelleId}/belegungen`);
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

/** Mit `client_id` idempotent (LFH-675): ein Replay liefert die gespeicherte Meldung. */
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

export function legeStelleAn(
  einsatzId: number,
  body: BetreuungsstelleEingabe,
): Promise<Betreuungsstelle> {
  return apiSend<Betreuungsstelle>(`${basis(einsatzId)}/stellen`, 'POST', body);
}

export function aendereStelle(
  einsatzId: number,
  stelleId: number,
  body: BetreuungsstellePatch,
): Promise<Betreuungsstelle> {
  return apiSend<Betreuungsstelle>(`${basis(einsatzId)}/stellen/${stelleId}`, 'PATCH', body);
}

/** Unumkehrbar (Fehlanlage); ein zweites Stornieren ist 409. */
export function storniereStelle(einsatzId: number, stelleId: number): Promise<Betreuungsstelle> {
  return apiSend<Betreuungsstelle>(
    `${basis(einsatzId)}/stellen/${stelleId}/stornieren`,
    'POST',
    {},
  );
}

/** An eine geschlossene Stelle ist 422 — außer für den Replay einer schon gespeicherten Meldung. */
export function meldeBelegung(
  einsatzId: number,
  stelleId: number,
  body: BelegungsmeldungEingabe,
  optionen?: ApiSendOptionen,
): Promise<StelleMeldung> {
  return apiSend<StelleMeldung>(
    `${basis(einsatzId)}/stellen/${stelleId}/belegungen`,
    'POST',
    body,
    optionen,
  );
}

/** Rückweg einer Belegungsmeldung; `meldungId` ist `StelleMeldung.meldung_id`. */
export function nimmBelegungZurueck(einsatzId: number, meldungId: number): Promise<StelleMeldung> {
  return apiSend<StelleMeldung>(
    `${basis(einsatzId)}/belegungen/${meldungId}/zuruecknehmen`,
    'POST',
    {},
  );
}
