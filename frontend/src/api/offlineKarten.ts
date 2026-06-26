import { apiGet, apiSend } from './client';

/**
 * Frontend-Seam für den Offline-Karten-Manager (LFH-181). Verdrahtet die
 * `/api/karte/offline-karten`-Endpunkte (Liste/Download/Aktivieren/Abbrechen/Löschen + Katalog).
 * Einziger API-Berührungspunkt der Offline-Verwaltung — Komponenten importieren nur von hier.
 */

export type OfflineKarteStatus = 'registriert' | 'laedt' | 'bereit' | 'fehler';

/** Eine persistierte Offline-Karte (Server-Antwort inkl. Lebenszyklus-Feldern). */
export interface OfflineKarte {
  id: number;
  name: string;
  pfad: string;
  quell_url: string | null;
  lizenz: string | null;
  kachel_schema: string;
  groesse: number | null;
  sha256: string | null;
  download_at: string | null;
  status: OfflineKarteStatus;
  aktiv_basemap: boolean;
  sortier: number;
  /** Live-Download-Fortschritt (Bytes), nur für status='laedt'. `gesamt` null ohne Content-Length. */
  geladen?: number | null;
  gesamt?: number | null;
}

/** Body zum Starten eines Downloads (aus Katalog oder eigener URL). `lizenz` ist Pflicht. */
export interface OfflineDownloadBody {
  name: string;
  url: string;
  lizenz: string;
  kachel_schema?: string;
  /** Erwartete Größe (Bytes) aus dem Katalog — für den Plattenplatz-Check vorab. */
  groesse_erwartet?: number;
}

/** Ein kuratierter, herunterladbarer Vorschlag (Server-autoritativ). */
export interface OfflineKatalogEintrag {
  name: string;
  url: string;
  region: string;
  groesse: number;
  lizenz: string;
  kachel_schema: string;
  quelle: string;
}

export function listeOfflineKarten(): Promise<OfflineKarte[]> {
  return apiGet<OfflineKarte[]>('/api/karte/offline-karten');
}

export function starteOfflineDownload(body: OfflineDownloadBody): Promise<OfflineKarte> {
  return apiSend<OfflineKarte>('/api/karte/offline-karten/download', 'POST', body);
}

export function aktiviereOfflineKarte(id: number): Promise<OfflineKarte> {
  return apiSend<OfflineKarte>(`/api/karte/offline-karten/${id}/aktivieren`, 'POST');
}

export function brecheOfflineDownloadAb(id: number): Promise<void> {
  return apiSend<void>(`/api/karte/offline-karten/${id}/abbrechen`, 'POST');
}

export function loescheOfflineKarte(id: number): Promise<void> {
  return apiSend<void>(`/api/karte/offline-karten/${id}`, 'DELETE');
}

/** Server-autoritativer Download-Vorschlagskatalog (kuratierte PMTiles-Quellen). */
export function ladeOfflineKatalog(): Promise<OfflineKatalogEintrag[]> {
  return apiGet<OfflineKatalogEintrag[]>('/api/karte/offline-karten/katalog');
}
