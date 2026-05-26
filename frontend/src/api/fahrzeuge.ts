import type { Fahrzeug } from './types';
import { apiGet, apiSend } from './client';

/** Editierbare Stammfelder (Anlegen + Vollersatz-PATCH). */
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

export function ladeFahrzeugTypen(): Promise<string[]> {
  return apiGet<string[]>('/api/fahrzeug-typen');
}

export function legeFahrzeugAn(daten: FahrzeugEingabe): Promise<Fahrzeug> {
  return apiSend<Fahrzeug>('/api/fahrzeuge', 'POST', daten);
}

export function aktualisiereFahrzeug(id: number, daten: FahrzeugEingabe): Promise<Fahrzeug> {
  return apiSend<Fahrzeug>(`/api/fahrzeuge/${id}`, 'PATCH', daten);
}

export function setzeDienststatus(id: number, inDienst: boolean): Promise<Fahrzeug> {
  const pfad = inDienst ? 'in-dienst' : 'ausser-dienst';
  return apiSend<Fahrzeug>(`/api/fahrzeuge/${id}/${pfad}`, 'POST');
}
