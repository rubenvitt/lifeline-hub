import { apiGet, apiSend } from './client';
import type { components } from './types.generated';

/**
 * Frontend-Seam für den Offline-Karten-Manager (LFH-181). Verdrahtet die
 * `/api/karte/offline-karten`-Endpunkte (Liste/Download/Aktivieren/Abbrechen/Löschen + Katalog).
 * Einziger API-Berührungspunkt der Offline-Verwaltung — Komponenten importieren nur von hier.
 *
 * LFH-265 (Teil A, Frontend): die Response-Typen sind Re-Exporte der generierten Schemas.
 * Eingabe-Bodies (`Offline*Body`, `RegistriereBody`) bleiben handgepflegt (CLAUDE.md), ebenso
 * die roh durchgereichten karten-service-Typen ganz unten.
 */

type S = components['schemas'];

export type OfflineKarteStatus = S['OfflineKarteStatus'];

/**
 * Eine Offline-Karte, wie die LISTE sie liefert. Rust: `OfflineKarteAntwort` = DB-Zeile
 * (`OfflineKarte`) + Live-Download-Fortschritt (`geladen`/`gesamt`) + Katalog-Abgleich
 * (`update_verfuegbar`/`katalog_url`/`katalog_sha256`).
 *
 * `update_verfuegbar` ist PFLICHT — das Backend berechnet es für jede Listen-Zeile; die alte
 * Handrolle führte es fälschlich optional (genau die Drift, die LFH-265 auflöst).
 */
export type OfflineKarte = S['OfflineKarteAntwort'];

/**
 * Die nackte DB-Zeile OHNE Fortschritts- und Katalog-Felder. Rust: `OfflineKarte`.
 *
 * WARUM ZWEI TYPEN (LFH-265): nur `GET /offline-karten` antwortet mit `OfflineKarteAntwort`;
 * die vier schreibenden Endpunkte (`download`/`aktivieren`/`neu-laden`, `POST /offline-karten`)
 * geben die bare Zeile zurück — verifiziert an den Handler-Signaturen in `src/routes/karte.rs`.
 * Beide auf den Listen-Typ zu mappen wäre bequem und FALSCH: der Client bekäme ein garantiert
 * vorhandenes `update_verfuegbar` zugesagt, das auf dem Wire fehlt. Kein Konsument liest die
 * Mutations-Antwort heute aus (alle invalidieren nur), deshalb ist das reine Typ-Ehrlichkeit —
 * aber genau die ist der Zweck des Codegens.
 */
export type OfflineKarteZeile = S['OfflineKarte'];

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
export type OfflineKatalogEintrag = S['OfflineKatalogEintrag'];

export function listeOfflineKarten(): Promise<OfflineKarte[]> {
  return apiGet<OfflineKarte[]>('/api/karte/offline-karten');
}

export function starteOfflineDownload(body: OfflineDownloadBody): Promise<OfflineKarteZeile> {
  return apiSend<OfflineKarteZeile>('/api/karte/offline-karten/download', 'POST', body);
}

export function aktiviereOfflineKarte(id: number): Promise<OfflineKarteZeile> {
  return apiSend<OfflineKarteZeile>(`/api/karte/offline-karten/${id}/aktivieren`, 'POST');
}

/** In-Place-Hot-Swap (B3): Update der aktiven Karte in dieselbe Zeile — downtime-frei. */
export function neuLadeOfflineKarte(id: number, body: OfflineNeuLadenBody): Promise<OfflineKarteZeile> {
  return apiSend<OfflineKarteZeile>(`/api/karte/offline-karten/${id}/neu-laden`, 'POST', body);
}

export function brecheOfflineDownloadAb(id: number): Promise<void> {
  return apiSend<void>(`/api/karte/offline-karten/${id}/abbrechen`, 'POST');
}

export function loescheOfflineKarte(id: number): Promise<void> {
  return apiSend<void>(`/api/karte/offline-karten/${id}`, 'DELETE');
}

/** Server-autoritativer Download-Vorschlagskatalog (kuratierte MBTiles-Quellen). `frisch` umgeht die
 *  Manifest-Cache-TTL (LFH-206, „Bauen & laden"): direkt nach einem Bau den neuen Eintrag sofort sehen. */
export function ladeOfflineKatalog(frisch = false): Promise<OfflineKatalogEintrag[]> {
  return apiGet<OfflineKatalogEintrag[]>(
    `/api/karte/offline-karten/katalog${frisch ? '?frisch=1' : ''}`,
  );
}

/** Eine im karten_dir vorhandene, noch nicht registrierte MBTiles-Datei (lokaler Import, LFH-199). */
export type VorhandeneKarte = S['VorhandeneKarte'];

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
export function registriereOfflineKarte(body: RegistriereBody): Promise<OfflineKarteZeile> {
  return apiSend<OfflineKarteZeile>('/api/karte/offline-karten', 'POST', body);
}

// ===== Region-Bau (zentraler karten-service, LFH-203) =====
//
// BEWUSST HANDGEPFLEGT (LFH-265, Allowlist-Bucket „karten-service-Durchreiche" in
// `apiResponseTypen.guard.test.ts`): diese vier Formen beschreiben KEIN Lifeline-Hub-DTO,
// sondern die Antwort des externen karten-service, die das Backend als `serde_json::Value`
// roh durchreicht. Es gibt für sie kein `ToSchema`-Struct und damit kein generiertes Schema —
// ein Re-Export ist hier nicht möglich, nicht bloß unbequem.

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
