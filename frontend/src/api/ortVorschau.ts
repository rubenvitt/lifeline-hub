import { apiGet } from './client';

/** Peilung zum nächsten bekannten verorteten Punkt des Einsatzes. */
export interface Peilung {
  distanz_m: number;
  richtung: string;
  bezug_label: string;
}

/** Antwort von GET /api/einsaetze/:id/ort-vorschau. Beide Felder degradieren zu null. */
export interface OrtVorschau {
  peilung: Peilung | null;
  ortsname: string | null;
}

/** Lädt die Ort-Vorschau (Peilung + ggf. Ortsname) für eine Koordinate. */
export function ladeOrtVorschau(
  einsatzId: number,
  lat: number,
  lon: number,
  exclude?: string,
): Promise<OrtVorschau> {
  const p = new URLSearchParams({ lat: String(lat), lon: String(lon) });
  if (exclude) p.set('exclude', exclude);
  return apiGet<OrtVorschau>(`/api/einsaetze/${einsatzId}/ort-vorschau?${p.toString()}`);
}
