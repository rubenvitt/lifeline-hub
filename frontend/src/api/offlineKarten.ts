import { apiGet, apiSend } from './client';
import type { components } from './types.generated';

/**
 * Frontend-Seam für den Offline-Karten-Manager: `/api/karte/offline-karten` (Liste, Download,
 * Aktivieren, Abbrechen, Löschen, Katalog). Komponenten importieren nur von hier.
 * Response-Typen sind Re-Exporte der generierten Schemas, auch die karten-service-Typen unten;
 * Eingabe-Bodies bleiben handgepflegt.
 */

type S = components['schemas'];

export type OfflineKarteStatus = S['OfflineKarteStatus'];

/**
 * Eine Offline-Karte, wie die LISTE sie liefert. Rust: `OfflineKarteAntwort` = DB-Zeile +
 * Download-Fortschritt (`geladen`/`gesamt`) + Katalog-Abgleich (`update_verfuegbar` usw.).
 * `update_verfuegbar` ist PFLICHT.
 */
export type OfflineKarte = S['OfflineKarteAntwort'];

/**
 * Die nackte DB-Zeile OHNE Fortschritts- und Katalog-Felder. Rust: `OfflineKarte`. Nur
 * `GET /offline-karten` liefert `OfflineKarteAntwort`; die schreibenden Endpunkte geben die bare
 * Zeile zurück, ein gemeinsamer Typ sagte ein Feld zu, das auf dem Wire fehlt.
 */
type OfflineKarteZeile = S['OfflineKarte'];

/** Body zum Starten eines Downloads (aus Katalog oder eigener URL). `lizenz` ist Pflicht. */
interface OfflineDownloadBody {
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
 * Body für den In-Place-Reload: lädt ein Update der bestehenden Karte in DIESELBE Zeile/Datei.
 * Name/Lizenz bleiben; anders als `ersetzt_karte_id` (neue Zeile) bleibt die id stabil, und die
 * alte Datei wird bis zum atomaren Swap weiter ausgeliefert.
 */
interface OfflineNeuLadenBody {
  url: string;
  /** Erwartete Größe (Bytes) — Plattenplatz-Vorabcheck. */
  groesse_erwartet?: number;
  /** Erwarteter SHA256 (hex) aus dem Katalog-Pin — Backend verifiziert beim Download. */
  sha256_erwartet?: string;
}

/** Ein kuratierter, herunterladbarer Vorschlag (Server-autoritativ). */
export type OfflineKatalogEintrag = S['OfflineKatalogEintrag'];

export function listeOfflineKarten(): Promise<OfflineKarte[]> {
  return apiGet<OfflineKarte[]>('/api/karte/offline-karten');
}

export function starteOfflineDownload(body: OfflineDownloadBody): Promise<OfflineKarteZeile> {
  return apiSend<OfflineKarteZeile>('/api/karte/offline-karten/download', 'POST', body);
}

/** In-Place-Hot-Swap: Update der aktiven Karte in dieselbe Zeile, downtime-frei. */
export function neuLadeOfflineKarte(
  id: number,
  body: OfflineNeuLadenBody,
): Promise<OfflineKarteZeile> {
  return apiSend<OfflineKarteZeile>(`/api/karte/offline-karten/${id}/neu-laden`, 'POST', body);
}

export function brecheOfflineDownloadAb(id: number): Promise<void> {
  return apiSend<void>(`/api/karte/offline-karten/${id}/abbrechen`, 'POST');
}

export function loescheOfflineKarte(id: number): Promise<void> {
  return apiSend<void>(`/api/karte/offline-karten/${id}`, 'DELETE');
}

/** Server-autoritativer Download-Vorschlagskatalog (kuratierte MBTiles-Quellen). `frisch` umgeht
 *  die Manifest-Cache-TTL, damit ein gerade gebauter Eintrag sofort erscheint. */
export function ladeOfflineKatalog(frisch = false): Promise<OfflineKatalogEintrag[]> {
  return apiGet<OfflineKatalogEintrag[]>(
    `/api/karte/offline-karten/katalog${frisch ? '?frisch=1' : ''}`,
  );
}

/** Eine im karten_dir vorhandene, noch nicht registrierte MBTiles-Datei (lokaler Import). */
export type VorhandeneKarte = S['VorhandeneKarte'];

/** Body zum Registrieren einer bereits im karten_dir liegenden Karte (lokaler Import). */
interface RegistriereBody {
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
export function registriereOfflineKarte(body: RegistriereBody): Promise<OfflineKarteZeile> {
  return apiSend<OfflineKarteZeile>('/api/karte/offline-karten', 'POST', body);
}

// ===== Region-Bau (zentraler karten-service) =====
// Re-Exporte der generierten Schemas (Crate `karten-katalog`: `BuildJob`/`JobStatus`/`RegionDto`);
// die FE-Namen bleiben `Bau…`.

/** Ein Build-Job des zentralen karten-service (`/bau-status`). */
export type BauJob = S['BuildJob'];

/** Verschachtelter Build-Status ({status, fehler?}) — adjacently-tagged Union aus dem Backend. */
export type BauJobStatus = BauJob['status'];

/** Die einzelnen Status-Phasen (`queued`…`failed`) — Diskriminante der Union. */
export type BauStatus = BauJobStatus['status'];

/** Eine vom zentralen karten-service baubare Region (`/baubare-regionen`). */
export type BaubareRegion = S['RegionDto'];

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
