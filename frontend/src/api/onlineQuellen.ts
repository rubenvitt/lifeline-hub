import { apiGet, apiSend } from './client';
import type { OnlineStyle, OnlineStyleTyp } from './karte';
import type { components } from './types.generated';

/**
 * Frontend-Seam für die Online-Basemap-Quellen (`/api/karte/online-quellen`); Komponenten
 * importieren ausschließlich von hier. `OnlineQuelle` ist ein Re-Export des generierten Schemas,
 * `OnlineQuelleBody` bleibt als Eingabe-DTO handgepflegt.
 */

/** Eine persistierte Online-Quelle. `proxy` = serverseitig proxen (key-basierte Anbieter); bei
 *  aktivem Proxy maskiert der Server die `url` für Nicht-Admins (`***`). */
export type OnlineQuelle = components['schemas']['OnlineQuelle'];

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
  /** Über den Server proxen (key-basierte Anbieter). Default false. */
  proxy: boolean;
}

export function listeOnlineQuellen(): Promise<OnlineQuelle[]> {
  return apiGet<OnlineQuelle[]>('/api/karte/online-quellen');
}

export function legeOnlineQuelleAn(body: OnlineQuelleBody): Promise<OnlineQuelle> {
  return apiSend<OnlineQuelle>('/api/karte/online-quellen', 'POST', body);
}

export function aktualisiereOnlineQuelle(
  id: number,
  body: OnlineQuelleBody,
): Promise<OnlineQuelle> {
  return apiSend<OnlineQuelle>(`/api/karte/online-quellen/${id}`, 'PATCH', body);
}

export function loescheOnlineQuelle(id: number): Promise<void> {
  return apiSend<void>(`/api/karte/online-quellen/${id}`, 'DELETE');
}

/** Server-autoritativer Vorschlagskatalog (kuratierte Styles, ohne id/sortier/aktiv). */
export function ladeOnlineQuellenKatalog(): Promise<OnlineStyle[]> {
  return apiGet<OnlineStyle[]>('/api/karte/online-quellen/katalog');
}
