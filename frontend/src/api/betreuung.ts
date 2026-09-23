import { apiGet, apiSend } from './client';
import type {
  BelegungKopfzahl,
  BelegungsmeldungEingabe,
  BetreuungUebersicht,
  Betreuungsstelle,
  BetreuungsstelleEingabe,
  BetreuungsstellePatch,
  BezirkMeldung,
  Evakuierungsbezirk,
  EvakuierungsbezirkEingabe,
  EvakuierungsbezirkPatch,
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

export function meldeStand(
  einsatzId: number,
  bezirkId: number,
  body: StandmeldungEingabe,
): Promise<BezirkMeldung> {
  return apiSend<BezirkMeldung>(`${basis(einsatzId)}/bezirke/${bezirkId}/staende`, 'POST', body);
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

/** An eine geschlossene Stelle ist 422. */
export function meldeBelegung(
  einsatzId: number,
  stelleId: number,
  body: BelegungsmeldungEingabe,
): Promise<StelleMeldung> {
  return apiSend<StelleMeldung>(`${basis(einsatzId)}/stellen/${stelleId}/belegungen`, 'POST', body);
}

/** Rückweg einer Belegungsmeldung; `meldungId` ist `StelleMeldung.meldung_id`. */
export function nimmBelegungZurueck(einsatzId: number, meldungId: number): Promise<StelleMeldung> {
  return apiSend<StelleMeldung>(
    `${basis(einsatzId)}/belegungen/${meldungId}/zuruecknehmen`,
    'POST',
    {},
  );
}
