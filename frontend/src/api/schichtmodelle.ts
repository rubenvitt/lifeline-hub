import { apiGet, apiSend } from './client';
import type { Schichtmodell, SchichtmodellBody, SchichtmodellWerteBody } from './types';

/**
 * Schichtmodelle der Organisation (LLH-1122, Spec `kraefte-abloesung`, „Schichtmodelle der
 * Organisation“). Lesen jedes Mitglied, schreiben nur der Admin; jede Änderung meldet das
 * Org-Ereignis `stammdaten`.
 */

/** Die Modelle der eigenen Organisation, die Vorgabe zuerst (Ordnung vom Server). */
export function fetchSchichtmodelle(): Promise<Schichtmodell[]> {
  return apiGet<Schichtmodell[]>('/api/schichtmodelle');
}

export function createSchichtmodell(body: SchichtmodellBody): Promise<Schichtmodell> {
  return apiSend<Schichtmodell>('/api/schichtmodelle', 'POST', body);
}

/** Vollersatz: der ganze Satz samt `ist_vorgabe`. */
export function updateSchichtmodell(id: number, body: SchichtmodellBody): Promise<Schichtmodell> {
  return apiSend<Schichtmodell>(`/api/schichtmodelle/${id}`, 'PUT', body);
}

/** Einsätze behalten ihre Kopie. */
export function deleteSchichtmodell(id: number): Promise<void> {
  return apiSend<void>(`/api/schichtmodelle/${id}`, 'DELETE');
}

/** Die Werte eines Modells als Body, ohne die Felder des anderen Typs (sonst 422). */
export function werteBodyOf(m: SchichtmodellWerteBodyQuelle): SchichtmodellWerteBody {
  const basis = {
    bezeichnung: m.bezeichnung,
    typ: m.typ,
    vorwarnung_minuten: m.vorwarnung_minuten,
    planungsvorlauf_minuten: m.planungsvorlauf_minuten,
  };
  return m.typ === 'rhythmus'
    ? { ...basis, rhythmus_minuten: m.rhythmus_minuten ?? undefined }
    : {
        ...basis,
        wechselzeiten: m.wechselzeiten ?? undefined,
        mindestdauer_minuten: m.mindestdauer_minuten ?? undefined,
      };
}

/** Was ein Modell der Organisation und die Kopie am Einsatz gemeinsam tragen. */
type SchichtmodellWerteBodyQuelle = Pick<
  Schichtmodell,
  | 'bezeichnung'
  | 'typ'
  | 'rhythmus_minuten'
  | 'wechselzeiten'
  | 'mindestdauer_minuten'
  | 'vorwarnung_minuten'
  | 'planungsvorlauf_minuten'
>;

/**
 * Macht `ziel` zur Vorgabe der Organisation oder hebt seine Vorgabe auf (`istVorgabe = false`).
 *
 * Der Server hält höchstens eine Vorgabe und lehnt eine zweite mit 409 ab; ein Wechsel geht
 * deshalb in zwei Schritten: erst die bisherige Vorgabe aufheben, dann das Ziel setzen (beides
 * `PUT` mit dem ganzen Satz). Für die Person ist es ein Handgriff. Scheitert der zweite Schritt,
 * wird die bisherige Vorgabe wiederhergestellt, damit die Organisation nicht still ohne Vorgabe
 * dasteht; der Fehler des zweiten Schritts geht an den Aufrufer.
 */
export async function setOrgVorgabe(
  ziel: Schichtmodell,
  istVorgabe: boolean,
  bisherige: Schichtmodell | undefined,
): Promise<void> {
  const andere = istVorgabe && bisherige && bisherige.id !== ziel.id ? bisherige : undefined;
  if (andere) {
    await updateSchichtmodell(andere.id, { ...werteBodyOf(andere), ist_vorgabe: false });
  }
  try {
    await updateSchichtmodell(ziel.id, { ...werteBodyOf(ziel), ist_vorgabe: istVorgabe });
  } catch (e) {
    if (andere) {
      await updateSchichtmodell(andere.id, { ...werteBodyOf(andere), ist_vorgabe: true }).catch(
        () => undefined,
      );
    }
    throw e;
  }
}
