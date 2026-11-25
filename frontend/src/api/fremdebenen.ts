import { apiGet, apiSend, apiUploadMitFortschritt, type UploadFortschritt } from './client';
import type { FeatureCollection } from './fachebenen';
import { FREMDEBENE_NAME_MAX } from './eingabegrenzen';
import type { components } from './types.generated';
import { UPLOAD_TIMEOUT_MS } from './upload';

/** Rust: `FremdebeneAnzeige` (LLH-2099). Die `url` kommt nur für Schreibende, `url_host` immer. */
export type Fremdebene = components['schemas']['FremdebeneAnzeige'];
/** Rust: `FremdebeneFehler`, der `grund` einer abgelehnten Datei und `error` einer URL-Ebene. */
export type FremdebeneFehler = components['schemas']['FremdebeneFehler'];

/** Grenzen des Servers (`karte_fremdebene::DATEI_MAX`, `NAME_MAX`, `GEOJSON_MAX`). */
export const FREMDEBENE_GRENZEN = {
  dateiBytes: 10 * 1024 * 1024,
  /** Normiertes GeoJSON einer Ebene höchstens (LLH-2130: Schätzwert ohne `data_size`). */
  geojsonBytes: 8 * 1024 * 1024,
  nameMax: FREMDEBENE_NAME_MAX,
} as const;

/**
 * Text zum Code, wortgleich mit `FremdebeneFehler::meldung` im Server (`src/karte_fremdebene/
 * mod.rs`); der Client zeigt ihn zum `grund` einer Ablehnung und zum `error` einer URL-Ebene.
 */
export const FREMDEBENE_FEHLERTEXT: Record<FremdebeneFehler, string> = {
  unlesbar: 'Die Datei ist kein GeoJSON, KML oder KMZ.',
  dtd: 'Die Datei enthält eine DTD und wird aus Sicherheitsgründen nicht gelesen.',
  zu_gross: 'Die Datei ist zu groß (höchstens 10 MB).',
  zu_umfangreich: 'Die Datei ist zu umfangreich.',
  zu_viele_objekte: 'Die Datei enthält zu viele Objekte (höchstens 5000).',
  leer: 'Die Datei enthält keine lesbaren Orte.',
  koordinaten: 'Die Koordinaten liegen außerhalb der Erde. Ist die Datei in WGS84?',
  virus: 'Die Datei wurde vom Virenscanner abgelehnt.',
  nicht_erreichbar: 'Die Adresse ist nicht erreichbar.',
  weiterleitung: 'Die Adresse leitet weiter; Weiterleitungen werden nicht verfolgt.',
  abgelehnt: 'Die Adresse wird nicht abgerufen (nur https).',
  status: 'Die Adresse hat mit einem Fehler geantwortet.',
  ziel_intern: 'Die Adresse liegt in einem internen Netz.',
  zeitlimit: 'Die Adresse hat nicht rechtzeitig geantwortet.',
};

const basis = (einsatzId: number) => `/api/incidents/${einsatzId}/map/foreign-layers`;

export function listeFremdebenen(einsatzId: number): Promise<Fremdebene[]> {
  return apiGet<Fremdebene[]>(basis(einsatzId));
}

/** Das normierte GeoJSON einer Ebene (Server: `ETag`, `Cache-Control: private, no-cache`). */
export function ladeFremdebeneDaten(
  einsatzId: number,
  ebeneId: number,
): Promise<FeatureCollection> {
  return apiGet<FeatureCollection>(`${basis(einsatzId)}/${ebeneId}/data`);
}

/**
 * Eine Fremdebene, wie ein gesicherter Stand sie einfriert (LLH-2130, Rust:
 * `lage_snapshot::fremdebene::FremdebeneImStand`): ohne `url`, mit dem Hash ihres Inhalts. `id`
 * ist am Spiegel `null`, wenn die Ebene dort nicht (mehr) besteht.
 */
export interface FremdebeneImStand {
  id: number | null;
  name: string;
  color: string;
  source: Fremdebene['source'];
  url_host?: string;
  fetched_at?: string;
  feature_count: number;
  dropped_count: number;
  sha256: string;
}

/** Der eingefrorene Inhalt einer Fremdebene eines Stands, adressiert über ihren Hash. */
export function ladeStandFremdebeneDaten(
  einsatzId: number,
  snapshotId: number,
  sha256: string,
): Promise<FeatureCollection> {
  return apiGet<FeatureCollection>(
    `/api/incidents/${einsatzId}/situation-snapshots/${snapshotId}/foreign-layers/${sha256}/data`,
  );
}

/** Genau eine Quelle: `datei` oder `url`. Ein leerer Name lässt den Server einen vorschlagen. */
export function legeFremdebeneAn(
  einsatzId: number,
  eingabe: { name: string; datei?: File; url?: string },
  onFortschritt?: (stand: UploadFortschritt) => void,
): Promise<Fremdebene> {
  const fd = new FormData();
  if (eingabe.name) fd.append('name', eingabe.name);
  if (eingabe.datei) fd.append('file', eingabe.datei);
  else if (eingabe.url) fd.append('url', eingabe.url);
  return apiUploadMitFortschritt<Fremdebene>(basis(einsatzId), fd, {
    timeoutMs: UPLOAD_TIMEOUT_MS,
    onFortschritt,
  });
}

export function aktualisiereFremdebene(
  einsatzId: number,
  ebeneId: number,
  patch: { name?: string; color?: string },
): Promise<Fremdebene> {
  return apiSend<Fremdebene>(`${basis(einsatzId)}/${ebeneId}`, 'PATCH', patch);
}

export function loescheFremdebene(einsatzId: number, ebeneId: number): Promise<void> {
  return apiSend<void>(`${basis(einsatzId)}/${ebeneId}`, 'DELETE');
}
