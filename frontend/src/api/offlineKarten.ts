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
  /** Kachel-Blob-Format (LFH-185): `'pbf'` (Vektor) oder `'png'`/`'jpg'`/`'webp'` (Raster). */
  format: string;
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

/** Eine im karten_dir vorhandene, noch nicht registrierte MBTiles-Datei (lokaler Import, LFH-199). */
export interface VorhandeneKarte {
  dateiname: string;
  groesse: number;
}

/** Body zum Registrieren einer bereits im karten_dir liegenden Karte (lokaler Import). */
export interface RegistriereBody {
  name: string;
  pfad: string;
  lizenz: string;
  kachel_schema?: string;
}

/** Listet gebaute/vorhandene Region-Packs im karten_dir, die noch nicht registriert sind. */
export function listeVorhandeneKarten(): Promise<VorhandeneKarte[]> {
  return apiGet<VorhandeneKarte[]>('/api/karte/offline-karten/vorhandene');
}

/** Registriert eine bereits vorhandene Datei als Offline-Karte (ohne Download/Hosting). */
export function registriereOfflineKarte(body: RegistriereBody): Promise<OfflineKarte> {
  return apiSend<OfflineKarte>('/api/karte/offline-karten', 'POST', body);
}

// ===== Region-Bau (zentraler karten-service, LFH-203) =====

export type BauStatus = 'queued' | 'building' | 'uploading' | 'publishing' | 'done' | 'failed';

/** karten-service serialisiert `status` als verschachteltes Objekt ({status, fehler?}), NICHT flach —
 *  der Proxy reicht es roh durch. */
export interface BauJobStatus {
  status: BauStatus;
  fehler?: string;
}

/** Ein Build-Job des zentralen karten-service (über `/bau-status` roh durchgereicht). */
export interface BauJob {
  id: number;
  slug: string;
  status: BauJobStatus;
  gestartet: string;
  beendet?: string | null;
}

/** Eine vom zentralen karten-service baubare Region (über `/baubare-regionen` roh durchgereicht). */
export interface BaubareRegion {
  slug: string;
  name: string;
  region: string;
  gruppe: string;
}

/** Stößt einen Region-Build beim zentralen karten-service an (Admin). */
export function starteRegionBau(slug: string): Promise<{ job_id: number }> {
  return apiSend<{ job_id: number }>('/api/karte/offline-karten/bauen', 'POST', { slug });
}

/** Listet die vom zentralen karten-service baubaren Regionen. */
export function ladeBaubareRegionen(): Promise<BaubareRegion[]> {
  return apiGet<BaubareRegion[]>('/api/karte/offline-karten/baubare-regionen');
}

/** Lädt den Build-Status (u.a. laufende/abgeschlossene Jobs) zum Polling im Admin-UI. */
export function ladeBauStatus(): Promise<BauJob[]> {
  return apiGet<BauJob[]>('/api/karte/offline-karten/bau-status');
}
