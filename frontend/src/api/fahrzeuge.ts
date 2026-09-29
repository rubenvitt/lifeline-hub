import type { Fahrzeug, FahrzeugVorschlaege } from './types';
import { apiGet, apiSend } from './client';
import { setzeDienststatusUnter } from './katalogApi';

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
 * Anlegen: nur `funkrufname` ist Pflicht (`FahrzeugBody` in `src/routes/fahrzeug.rs`). Die
 * Schnellerfassung schickt ihre vier Felder und sonst nichts.
 */
type FahrzeugNeu = { funkrufname: string } & Partial<Omit<FahrzeugEingabe, 'funkrufname'>>;

/**
 * PATCH ist ein ECHTER Teil-Patch: fehlender Key = unverändert, `null` = leeren. `Partial` ist der
 * Riegel gegen stillen Datenverlust: `FahrzeugFormModal` zeigt nur vier Felder, und der volle Satz
 * trüge für jedes nicht gezeigte Feld ein `null`. Die Detailseite schickt alle Felder, sie zeigt
 * sie auch alle.
 */
type FahrzeugPatch = Partial<FahrzeugEingabe>;

export function legeFahrzeugAn(daten: FahrzeugNeu): Promise<Fahrzeug> {
  return apiSend<Fahrzeug>('/api/fahrzeuge', 'POST', daten);
}

export function aktualisiereFahrzeug(id: number, daten: FahrzeugPatch): Promise<Fahrzeug> {
  return apiSend<Fahrzeug>(`/api/fahrzeuge/${id}`, 'PATCH', daten);
}

export function setzeDienststatus(id: number, inDienst: boolean): Promise<Fahrzeug> {
  return setzeDienststatusUnter<Fahrzeug>('/api/fahrzeuge', id, inDienst);
}
