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
  /** True, wenn der Katalog für dieselbe Karte eine neuere Quelle führt → „Update verfügbar". */
  update_verfuegbar?: boolean;
  /** Aktuelle Katalog-URL für den Re-Download, wenn ein Update verfügbar ist. */
  katalog_url?: string | null;
  /** SHA256-Pin der aktuellen Katalog-URL — für den verifizierten Re-Download beim Update. */
  katalog_sha256?: string | null;
}

/** Body zum Starten eines Downloads (aus Katalog oder eigener URL). `lizenz` ist Pflicht. */
export interface OfflineDownloadBody {
  name: string;
  url: string;
  lizenz: string;
  kachel_schema?: string;
  /** Erwartete Größe (Bytes) aus dem Katalog — für den Plattenplatz-Check vorab. */
  groesse_erwartet?: number;
  /** Erwarteter SHA256 (hex) aus dem Katalog-Pin — Backend verifiziert beim Download. */
  sha256_erwartet?: string;
  /** One-Click-Update: id der Karte, die dieser Download ersetzt (Backend swappt nach Erfolg). */
  ersetzt_karte_id?: number;
}

/**
 * Body für den In-Place-Reload (B3): lädt ein Update der bestehenden Karte in DIESELBE Zeile/Datei.
 * Name/Lizenz bleiben die der Karte (kein neuer Eintrag). Anders als `ersetzt_karte_id` (neue Zeile)
 * bleibt die id stabil und die alte Datei wird bis zum atomaren Swap weiter ausgeliefert.
 */
export interface OfflineNeuLadenBody {
  url: string;
  /** Erwartete Größe (Bytes) — Plattenplatz-Vorabcheck. */
  groesse_erwartet?: number;
  /** Erwarteter SHA256 (hex) aus dem Katalog-Pin — Backend verifiziert beim Download. */
  sha256_erwartet?: string;
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
  /** Optionaler SHA256-Pin (hex); null/undefined = kein Pin. */
  sha256?: string | null;
  /** Optionale UX-Gruppe für die geführte Auswahl (z. B. „Deutschland", „Bundesländer"). */
  gruppe?: string | null;
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

/** In-Place-Hot-Swap (B3): Update der aktiven Karte in dieselbe Zeile — downtime-frei. */
export function neuLadeOfflineKarte(id: number, body: OfflineNeuLadenBody): Promise<OfflineKarte> {
  return apiSend<OfflineKarte>(`/api/karte/offline-karten/${id}/neu-laden`, 'POST', body);
}

export function brecheOfflineDownloadAb(id: number): Promise<void> {
  return apiSend<void>(`/api/karte/offline-karten/${id}/abbrechen`, 'POST');
}

export function loescheOfflineKarte(id: number): Promise<void> {
  return apiSend<void>(`/api/karte/offline-karten/${id}`, 'DELETE');
}

/** Server-autoritativer Download-Vorschlagskatalog (kuratierte MBTiles-Quellen). */
export function ladeOfflineKatalog(): Promise<OfflineKatalogEintrag[]> {
  return apiGet<OfflineKatalogEintrag[]>('/api/karte/offline-karten/katalog');
}
