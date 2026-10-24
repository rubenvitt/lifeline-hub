import type { SchichtmodellTyp, SchichtmodellWerteBody } from '../api/types';
import { mitVorgabe } from '../components/vorgabeText';
import {
  dauerFeldText,
  dauerMinuten,
  formatDauer,
  parseUhrzeiten,
  uhrzeitenFeldText,
} from './dauer';
import type { RegelFelder } from './schichtmodellText';

/**
 * Formular eines Schichtmodells (LLH-1122), rein: Vorbelegung aus einem Modell und der Body an
 * den Server. Dauern stehen als Text im Feld („7:30 h“), Wechselzeiten taktisch („0600/1800“).
 * Genutzt in den Stammdaten und für eigene Werte am Einsatz (`abloesung/SchichtmodellModal.tsx`).
 */

/** Vorwarnung, wenn das Modell nichts anderes sagt (Server: `VORWARNUNG_VORGABE_MINUTEN`). */
export const VORWARNUNG_VORGABE_MINUTEN = 30;
/** Planungsvorlauf, wenn das Modell nichts anderes sagt (Server: `PLANUNGSVORLAUF_VORGABE_MINUTEN`). */
export const PLANUNGSVORLAUF_VORGABE_MINUTEN = 120;

export interface SchichtmodellFormWerte {
  bezeichnung?: string;
  typ: SchichtmodellTyp;
  rhythmus?: string;
  wechselzeiten?: string;
  mindestdauer?: string;
  vorwarnung?: string;
  planungsvorlauf?: string;
}

/** Was ein Modell der Organisation und die Kopie am Einsatz zum Vorbelegen tragen. */
export type SchichtmodellVorlage = RegelFelder & {
  bezeichnung: string;
  vorwarnung_minuten: number;
  planungsvorlauf_minuten: number;
};

/**
 * Vorbelegung des Formulars. Vorwarnung und Planungsvorlauf bleiben leer, solange sie der
 * Vorgabe entsprechen: dann zeigt der Platzhalter den Wert, und ein leeres Feld schickt nichts.
 */
export function toFormWerte(m: SchichtmodellVorlage | null): SchichtmodellFormWerte {
  if (!m) return { typ: 'rhythmus' };
  return {
    bezeichnung: m.bezeichnung,
    typ: m.typ,
    rhythmus: m.typ === 'rhythmus' ? dauerFeldText(m.rhythmus_minuten) : undefined,
    wechselzeiten: m.typ === 'wechselzeiten' ? uhrzeitenFeldText(m.wechselzeiten ?? []) : undefined,
    mindestdauer: m.typ === 'wechselzeiten' ? dauerFeldText(m.mindestdauer_minuten) : undefined,
    vorwarnung:
      m.vorwarnung_minuten === VORWARNUNG_VORGABE_MINUTEN
        ? undefined
        : formatDauer(m.vorwarnung_minuten),
    planungsvorlauf:
      m.planungsvorlauf_minuten === PLANUNGSVORLAUF_VORGABE_MINUTEN
        ? undefined
        : formatDauer(m.planungsvorlauf_minuten),
  };
}

/**
 * Body an den Server aus geprüften Feldern: nur die Felder des Typs (sonst 422), leere
 * Vorwarnung und leerer Planungsvorlauf fehlen (= Vorgabe des Servers).
 */
export function buildWerteBody(w: SchichtmodellFormWerte): SchichtmodellWerteBody {
  const body: SchichtmodellWerteBody = { bezeichnung: (w.bezeichnung ?? '').trim(), typ: w.typ };
  if (w.typ === 'rhythmus') {
    body.rhythmus_minuten = dauerMinuten(w.rhythmus) ?? undefined;
  } else {
    const zeiten = parseUhrzeiten(w.wechselzeiten);
    body.wechselzeiten = zeiten.art === 'zeiten' ? zeiten.zeiten : [];
    body.mindestdauer_minuten = dauerMinuten(w.mindestdauer) ?? undefined;
  }
  const vorwarnung = dauerMinuten(w.vorwarnung);
  if (vorwarnung != null) body.vorwarnung_minuten = vorwarnung;
  const vorlauf = dauerMinuten(w.planungsvorlauf);
  if (vorlauf != null) body.planungsvorlauf_minuten = vorlauf;
  return body;
}

/** Kopf des Klappteils: nennt die wirksamen Werte, auch die Vorgabe (LFH-974). */
export function vorlaufKopf(
  w: Pick<SchichtmodellFormWerte, 'vorwarnung' | 'planungsvorlauf'>,
): string {
  const vorwarnung = dauerMinuten(w.vorwarnung);
  const vorlauf = dauerMinuten(w.planungsvorlauf);
  const teil = (wert: number | null, vorgabe: number) =>
    wert == null ? mitVorgabe(formatDauer(vorgabe)) : formatDauer(wert);
  return `Vorwarnung ${teil(vorwarnung, VORWARNUNG_VORGABE_MINUTEN)} · Planungsvorlauf ${teil(
    vorlauf,
    PLANUNGSVORLAUF_VORGABE_MINUTEN,
  )}`;
}
