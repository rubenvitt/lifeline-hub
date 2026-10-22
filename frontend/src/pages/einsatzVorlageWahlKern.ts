import type { Einsatzart, EinsatzVorlage, StichwortVorschlag } from '../api/types';

/**
 * Wahl der Einsatz-Vorlage im Anlegedialog (LLH-1375, Spec `einsatz-vorlagen`, „Der Anlegedialog
 * bietet die Vorlage an“, design.md D3). Rein, damit die Vorrangregeln ohne Rendern prüfbar sind.
 *
 * - Ein gekoppeltes Stichwort stellt die Vorlage ein, solange sie nicht von Hand gewählt wurde;
 *   ein Stichwort ohne Kopplung stellt sie dann zurück auf „Alle Module“.
 * - Eine Handwahl (auch „Alle Module“) hat danach Vorrang vor jedem Stichwort.
 */
export interface VorlageWahl {
  /** `null` = „Alle Module“ (keine Vorlage). */
  vorlageId: number | null;
  vonHand: boolean;
}

export const OHNE_VORLAGE: VorlageWahl = { vorlageId: null, vonHand: false };

/** Die Vorlage, auf die ein Stichwort zeigt; nur eine, die die Organisation noch führt. */
export function gekoppelteVorlage(
  stichwort: string | undefined,
  vorschlaege: readonly StichwortVorschlag[],
  vorlagen: readonly EinsatzVorlage[],
): number | null {
  const text = stichwort?.trim() ?? '';
  if (text === '') return null;
  const id = vorschlaege.find((v) => v.text === text)?.vorlage_id ?? null;
  return id != null && vorlagen.some((v) => v.id === id) ? id : null;
}

/** Wahl nach einer Änderung des Stichworts. */
export function wahlNachStichwort(
  wahl: VorlageWahl,
  stichwort: string | undefined,
  vorschlaege: readonly StichwortVorschlag[],
  vorlagen: readonly EinsatzVorlage[],
): VorlageWahl {
  if (wahl.vonHand) return wahl;
  const vorlageId = gekoppelteVorlage(stichwort, vorschlaege, vorlagen);
  return vorlageId === wahl.vorlageId ? wahl : { vorlageId, vonHand: false };
}

/**
 * Die Einsatzart, die eine Vorlage vorbelegt; ohne Vorlage oder ohne Einsatzart die Startwahl des
 * Dialogs. Nur anzuwenden, solange niemand die Einsatzart von Hand geändert hat.
 */
export function einsatzartDerVorlage(
  vorlageId: number | null,
  vorlagen: readonly EinsatzVorlage[],
  start: Einsatzart,
): Einsatzart {
  const vorlage = vorlageId != null ? vorlagen.find((v) => v.id === vorlageId) : undefined;
  return vorlage?.einsatzart ?? start;
}
