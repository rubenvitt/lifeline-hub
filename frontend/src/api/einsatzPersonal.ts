import type {
  EinsatzPersonal,
  FuehrungskraftKarte,
  PersonalEntlassungAntwort,
  PersonalEntlassungRuecknahmeAntwort,
  PersonalEntlassungVorzustand,
  StaerkePosition,
} from './types';
import { apiGet, apiSend } from './client';
import type { PositionPatch } from './einheiten';

export interface AdhocEingabe {
  name: string;
  funktion?: string | null;
  traegerorganisation?: string | null;
  staerke_position?: StaerkePosition | null;
}

export function listeEinsatzPersonal(einsatzId: number): Promise<EinsatzPersonal[]> {
  return apiGet<EinsatzPersonal[]>(`/api/einsaetze/${einsatzId}/personal`);
}

/** Ziele und Auswahl einer Sammel-Disposition (LLH-1100). */
export interface SammelPersonalEingabe {
  personal_ids: number[];
  einheit_id?: number | null;
  /** `einsatz_fahrzeug.id`; mit Einheit muss es zu ihr gehören. */
  fahrzeug_id?: number | null;
}

/**
 * Mehrere Stamm-Personen in einem Schritt disponieren, optional in Einheit und auf Fahrzeug
 * (LLH-1100): alles oder nichts. Eine Ablehnung trägt die Gründe je Person in `ApiError.zeilen`.
 */
export function disponierePersonalSammel(
  einsatzId: number,
  eingabe: SammelPersonalEingabe,
): Promise<EinsatzPersonal[]> {
  return apiSend<EinsatzPersonal[]>(`/api/einsaetze/${einsatzId}/personal/sammel`, 'POST', {
    personal_ids: eingabe.personal_ids,
    einheit_id: eingabe.einheit_id ?? null,
    fahrzeug_id: eingabe.fahrzeug_id ?? null,
  });
}

export function disponiereAdhoc(einsatzId: number, adhoc: AdhocEingabe): Promise<EinsatzPersonal> {
  return apiSend<EinsatzPersonal>(`/api/einsaetze/${einsatzId}/personal`, 'POST', { adhoc });
}

/**
 * Felder des PATCH einer Disposition; fehlend = unverändert, `null` = leeren. `name`, `funktion`
 * (Qualifikation) und `traegerorganisation` nur bei Ad-hoc-Personen, eine Stamm-Person lehnt der
 * Server mit 422 ab (LLH-1067).
 */
export interface DispositionPatch {
  status_id?: number;
  staerke_position?: StaerkePosition | null;
  bemerkung?: string;
  einsatzfunktion?: string | null;
  name?: string;
  funktion?: string | null;
  traegerorganisation?: string | null;
}

/**
 * Altwerte einer Einzelangabe (Feld-CAS, LLH-1945): je Schlüssel des Patches der Wert beim Öffnen,
 * `null` = leer. Die Position ist der wirksame Wert, wie die Oberfläche ihn zeigt.
 */
export type DispositionErwartet = Partial<Omit<DispositionPatch, 'status_id' | 'bemerkung'>> & {
  bemerkung?: string | null;
};

/**
 * Ändert eine Disposition. Mit `erwartet` antwortet der Server 409 `veraltet`, wenn ein anderer
 * eine dieser Angaben inzwischen geändert hat; ohne schreibt er ohne Vergleich.
 */
export function updateDisposition(
  einsatzId: number,
  epId: number,
  felder: DispositionPatch,
  erwartet?: DispositionErwartet,
): Promise<EinsatzPersonal> {
  return apiSend<EinsatzPersonal>(
    `/api/einsaetze/${einsatzId}/personal/${epId}`,
    'PATCH',
    erwartet ? { ...felder, erwartet } : felder,
  );
}

/** Entlassene Kräfte des Einsatzes (LLH-1079, Block „Entlassen“); Stornierte liefert keine Liste. */
export function listEntlassenesPersonal(einsatzId: number): Promise<EinsatzPersonal[]> {
  return apiGet<EinsatzPersonal[]>(`/api/einsaetze/${einsatzId}/personal?entlassene=1`);
}

/**
 * Aus dem Einsatz entlassen (LLH-1079): die Zeile bleibt mit ihrer Zeitachse, Bindungen gehen.
 * Die Antwort trägt den Vorzustand, mit dem {@link nimmEntlassungZurueck} alles zurücknimmt
 * (LLH-1922); deshalb ohne Rückfrage.
 */
export function entlasseDisposition(
  einsatzId: number,
  epId: number,
): Promise<PersonalEntlassungAntwort> {
  return apiSend<PersonalEntlassungAntwort>(
    `/api/einsaetze/${einsatzId}/personal/${epId}/entlassen`,
    'POST',
  );
}

/**
 * „Rückgängig“ nach dem Entlassen (LLH-1922, Spec `kraefte-entlassung`): stellt den Zustand davor
 * her, ohne neue Periode in der Zeitachse; was inzwischen anders gebunden ist, steht in
 * `ausgelassen`. Nur direkt danach, nur für die entlassende Person und nur bei unberichtigter
 * Zeitachse, sonst 409; danach bleibt {@link reaktiviereDisposition}.
 */
export function nimmEntlassungZurueck(
  einsatzId: number,
  epId: number,
  vorzustand: PersonalEntlassungVorzustand,
): Promise<PersonalEntlassungRuecknahmeAntwort> {
  return apiSend<PersonalEntlassungRuecknahmeAntwort>(
    `/api/einsaetze/${einsatzId}/personal/${epId}/entlassen/zuruecknehmen`,
    'POST',
    vorzustand,
  );
}

/** Fehldisposition stornieren (LLH-1079): nur ohne Bindung und Spur in den ersten 15 Minuten. */
export function storniereDisposition(einsatzId: number, epId: number): Promise<void> {
  return apiSend<void>(`/api/einsaetze/${einsatzId}/personal/${epId}/stornieren`, 'POST');
}

/** Eine entlassene oder stornierte Kraft erneut disponieren (Block „Entlassen“). */
export function reaktiviereDisposition(einsatzId: number, epId: number): Promise<EinsatzPersonal> {
  return apiSend<EinsatzPersonal>(
    `/api/einsaetze/${einsatzId}/personal/${epId}/reaktivieren`,
    'POST',
  );
}

/** L‑2: Lädt die Führungskräfte-Marker für die Lagekarte. */
export function listeFuehrungskraefte(einsatzId: number): Promise<FuehrungskraftKarte[]> {
  return apiGet<FuehrungskraftKarte[]>(`/api/einsaetze/${einsatzId}/karte/fuehrungskraefte`);
}

/** L‑2: Verortet eine Führungskraft (Einsatzpersonal) auf der Lagekarte. */
export function verortePerson(
  einsatzId: number,
  epId: number,
  daten: PositionPatch,
): Promise<FuehrungskraftKarte> {
  return apiSend<FuehrungskraftKarte>(
    `/api/einsaetze/${einsatzId}/personal/${epId}/position`,
    'PATCH',
    daten,
  );
}
