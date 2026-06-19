import type {
  Einsatzart, EinsatzAnzeige, EinsatzRolle, MitgliedAnzeige,
  EinsatzEinstellungen, EinstellungenUpdate,
  ModulOverride, ModulOverrides, ModulOverrideUpdate,
} from './types';
import { apiGet, apiSend } from './client';

export function listeEinsaetze(): Promise<EinsatzAnzeige[]> {
  return apiGet<EinsatzAnzeige[]>('/api/einsaetze');
}

export function ladeEinsatz(id: number): Promise<EinsatzAnzeige> {
  return apiGet<EinsatzAnzeige>(`/api/einsaetze/${id}`);
}

export function legeEinsatzAn(bezeichnung: string, stichwort?: string): Promise<EinsatzAnzeige> {
  return apiSend<EinsatzAnzeige>('/api/einsaetze', 'POST', { bezeichnung, stichwort });
}

export function schliesseEinsatzAb(id: number): Promise<EinsatzAnzeige> {
  return apiSend<EinsatzAnzeige>(`/api/einsaetze/${id}/abschliessen`, 'POST');
}

export function ladeMitglieder(id: number): Promise<MitgliedAnzeige[]> {
  return apiGet<MitgliedAnzeige[]>(`/api/einsaetze/${id}/mitglieder`);
}

export function setzeMitglied(
  id: number,
  benutzerId: number,
  rolle: EinsatzRolle,
): Promise<MitgliedAnzeige[]> {
  return apiSend<MitgliedAnzeige[]>(`/api/einsaetze/${id}/mitglieder/${benutzerId}`, 'PUT', {
    einsatz_rolle: rolle,
  });
}

export function entferneMitglied(id: number, benutzerId: number): Promise<MitgliedAnzeige[]> {
  return apiSend<MitgliedAnzeige[]>(`/api/einsaetze/${id}/mitglieder/${benutzerId}`, 'DELETE');
}

/** Editierbare Kopffelder (Vollersatz beim atomaren Speichern). */
export interface KopfdatenUpdate {
  bezeichnung: string;
  stichwort: string | null;
  einsatzart: Einsatzart;
  einsatznummer_intern: string | null;
  leitstellen_nr: string | null;
  einsatzort: string | null;
  einsatzort_lat: number | null;
  einsatzort_lon: number | null;
  meldende_stelle: string | null;
  sachverhalt: string | null;
  anzahl_betroffene_initial: number | null;
  /** Alarmzeit im SQLite-Format 'YYYY-MM-DD HH:mm:ss'. */
  begonnen_at: string;
}

export function aktualisiereEinsatz(id: number, felder: KopfdatenUpdate): Promise<EinsatzAnzeige> {
  return apiSend<EinsatzAnzeige>(`/api/einsaetze/${id}`, 'PATCH', felder);
}

/** Einsatz-Einstellungen laden (LFH-131); existiert keine Zeile → Defaults (alle null). */
export function ladeEinstellungen(id: number): Promise<EinsatzEinstellungen> {
  return apiGet<EinsatzEinstellungen>(`/api/einsaetze/${id}/einstellungen`);
}

/** Einsatz-Einstellungen setzen (Vollersatz); nur bei aktivem Einsatz (sonst 409). */
export function speichereEinstellungen(
  id: number,
  felder: EinstellungenUpdate,
): Promise<EinsatzEinstellungen> {
  return apiSend<EinsatzEinstellungen>(`/api/einsaetze/${id}/einstellungen`, 'PUT', felder);
}

/** Modul-Overrides eines Einsatzes laden (LFH-132); Map modul_key→Override (leer = Defaults). */
export function ladeModulOverrides(id: number): Promise<ModulOverrides> {
  return apiGet<ModulOverrides>(`/api/einsaetze/${id}/modul-overrides`);
}

/** Sichtbarkeit + benötigte Rolle eines Moduls überschreiben; nur Einsatzleitung/Admin, aktiver Einsatz. */
export function setzeModulOverride(
  id: number,
  modulKey: string,
  update: ModulOverrideUpdate,
): Promise<ModulOverride> {
  return apiSend<ModulOverride>(`/api/einsaetze/${id}/modul-overrides/${modulKey}`, 'PUT', update);
}
