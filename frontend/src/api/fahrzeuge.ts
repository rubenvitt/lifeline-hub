import type { Fahrzeug, FahrzeugVorschlaege } from './types';
import { apiGet, apiSend } from './client';

/**
 * Die VOLLE Menge editierbarer Stammfelder — was `FahrzeugDetailPage` in einem Formular
 * zeigt und in einem Absenden schickt.
 */
export interface FahrzeugEingabe {
  funkrufname: string;
  fahrzeugtyp: string | null;
  traegerorganisation: string | null;
  kennzeichen: string | null;
  opta: string | null;
  standort: string | null;
  fms_issi: string | null;
  sondersignal: boolean;
  tragenkapazitaet: number | null;
  staerke_fuehrer: number | null;
  staerke_unterfuehrer: number | null;
  staerke_mannschaft: number | null;
  bemerkung: string | null;
}

export function listeFahrzeuge(nurImDienst = false): Promise<Fahrzeug[]> {
  const qs = nurImDienst ? '?nur_im_dienst=true' : '';
  return apiGet<Fahrzeug[]>(`/api/fahrzeuge${qs}`);
}

export function ladeFahrzeugVorschlaege(): Promise<FahrzeugVorschlaege> {
  return apiGet<FahrzeugVorschlaege>('/api/fahrzeug-vorschlaege');
}

/**
 * Anlegen: nur `funkrufname` ist Pflicht (`FahrzeugBody` in `src/routes/fahrzeug.rs:20` —
 * jedes weitere Feld ist `Option<T>`, `sondersignal` traegt ein `#[serde(default)]`). Die
 * gekuerzte Schnellerfassung schickt deshalb ihre vier Felder und sonst nichts.
 */
export type FahrzeugNeu = { funkrufname: string } & Partial<Omit<FahrzeugEingabe, 'funkrufname'>>;

/**
 * PATCH ist ein ECHTER Teil-Patch (LFH-306): fehlender Key = unveraendert, `null` = leeren.
 *
 * Der Typ ist deshalb `Partial` und nicht `FahrzeugEingabe` — und das ist keine Bequemlichkeit,
 * sondern der Riegel gegen einen stillen Datenverlust: seit LFH-346 · A7 zeigt
 * `FahrzeugFormModal` nur noch vier Felder. Schickte es weiterhin den vollen Satz, traege jedes
 * nicht gezeigte Feld ein `null` (`leerZuNull(undefined)` ist `null`) und ein Bearbeiten in der
 * Liste loeschte OPTA, Standort, FMS-ISSI, Tragenkapazitaet, Soll-Staerke und Bemerkung.
 * Die Detailseite schickt weiterhin alle Felder — sie zeigt sie auch alle.
 */
export type FahrzeugPatch = Partial<FahrzeugEingabe>;

export function legeFahrzeugAn(daten: FahrzeugNeu): Promise<Fahrzeug> {
  return apiSend<Fahrzeug>('/api/fahrzeuge', 'POST', daten);
}

export function aktualisiereFahrzeug(id: number, daten: FahrzeugPatch): Promise<Fahrzeug> {
  return apiSend<Fahrzeug>(`/api/fahrzeuge/${id}`, 'PATCH', daten);
}

export function setzeDienststatus(id: number, inDienst: boolean): Promise<Fahrzeug> {
  const pfad = inDienst ? 'in-dienst' : 'ausser-dienst';
  return apiSend<Fahrzeug>(`/api/fahrzeuge/${id}/${pfad}`, 'POST');
}
