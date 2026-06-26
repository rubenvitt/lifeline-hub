import { apiGet, apiSend } from './client';
import type { OnlineStyle, OnlineStyleTyp } from './karte';

/**
 * Frontend-Seam für die Online-Basemap-Quellen-Verwaltung (LFH-180).
 * Verdrahtet die LFH-179-Endpunkte unter `/api/karte/online-quellen`.
 * Einziger API-Berührungspunkt der Karten-Verwaltung — Komponenten importieren
 * ausschließlich von hier.
 */

/** Eine persistierte Online-Quelle (Server-Antwort, inkl. id/sortier/aktiv). */
export interface OnlineQuelle {
  id: number;
  name: string;
  url: string;
  typ: OnlineStyleTyp;
  attribution: string | null;
  sortier: number;
  aktiv: boolean;
}

/**
 * Schreib-Body für POST/PATCH (Vollersatz). Der Server erzwingt `attribution`
 * als Pflicht (400 bei leer) sowie name/url nicht-leer und typ ∈ {vektor,raster}
 * — das Formular führt `attribution` daher als required.
 */
export interface OnlineQuelleBody {
  name: string;
  url: string;
  typ: OnlineStyleTyp;
  attribution: string | null;
  sortier: number;
  aktiv: boolean;
}

export function listeOnlineQuellen(): Promise<OnlineQuelle[]> {
  return apiGet<OnlineQuelle[]>('/api/karte/online-quellen');
}

export function legeOnlineQuelleAn(body: OnlineQuelleBody): Promise<OnlineQuelle> {
  return apiSend<OnlineQuelle>('/api/karte/online-quellen', 'POST', body);
}

export function aktualisiereOnlineQuelle(id: number, body: OnlineQuelleBody): Promise<OnlineQuelle> {
  return apiSend<OnlineQuelle>(`/api/karte/online-quellen/${id}`, 'PATCH', body);
}

export function loescheOnlineQuelle(id: number): Promise<void> {
  return apiSend<void>(`/api/karte/online-quellen/${id}`, 'DELETE');
}

/** Server-autoritativer Vorschlagskatalog (kuratierte Styles, ohne id/sortier/aktiv). */
export function ladeOnlineQuellenKatalog(): Promise<OnlineStyle[]> {
  return apiGet<OnlineStyle[]>('/api/karte/online-quellen/katalog');
}
