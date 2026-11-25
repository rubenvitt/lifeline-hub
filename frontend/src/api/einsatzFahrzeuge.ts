import type {
  EinsatzFahrzeug,
  EntlassungAntwort,
  FahrzeugPatchAntwort,
  StatusRuecknahmeBeleg,
  EntlassungRuecknahmeAntwort,
  EntlassungVorzustand,
} from './types';
import { apiGet, apiSend } from './client';
import { zuruecknahmeQuery, type PositionPatch, type ZuruecknahmeFilter } from './einheiten';

export interface AdhocEingabe {
  funkrufname: string;
  fahrzeugtyp?: string | null;
  kennzeichen?: string | null;
  opta?: string | null;
  traegerorganisation?: string | null;
}

export function listeEinsatzFahrzeuge(einsatzId: number): Promise<EinsatzFahrzeug[]> {
  return apiGet<EinsatzFahrzeug[]>(`/api/incidents/${einsatzId}/vehicles`);
}

/** Auswahl und Ziel-Einheit einer Sammel-Disposition (LLH-1100). */
export interface SammelFahrzeugEingabe {
  fahrzeug_ids: number[];
  einheit_id?: number | null;
}

/**
 * Mehrere Stamm-Fahrzeuge in einem Schritt disponieren, optional in eine Einheit (LLH-1100):
 * alles oder nichts. Eine Ablehnung trägt die Gründe je Fahrzeug in `ApiError.zeilen`.
 */
export function disponiereFahrzeugeSammel(
  einsatzId: number,
  eingabe: SammelFahrzeugEingabe,
): Promise<EinsatzFahrzeug[]> {
  return apiSend<EinsatzFahrzeug[]>(`/api/incidents/${einsatzId}/vehicles/bulk`, 'POST', {
    fahrzeug_ids: eingabe.fahrzeug_ids,
    einheit_id: eingabe.einheit_id ?? null,
  });
}

export function disponiereAdhoc(einsatzId: number, adhoc: AdhocEingabe): Promise<EinsatzFahrzeug> {
  return apiSend<EinsatzFahrzeug>(`/api/incidents/${einsatzId}/vehicles`, 'POST', { adhoc });
}

/**
 * Angaben eines Ad-hoc-Fahrzeugs im Teil-Patch (LLH-1073, design.md D1): fehlender Key =
 * unverändert, `null` = leeren; der Funkrufname ist Pflicht und nie `null`. Bei einem
 * Stamm-Fahrzeug antwortet der Server mit 422 („im Stamm pflegen“).
 */
export interface AngabenPatch {
  funkrufname?: string;
  fahrzeugtyp?: string | null;
  kennzeichen?: string | null;
  traegerorganisation?: string | null;
  opta?: string | null;
}

/** Der Zeilen-PATCH einer Disposition: Status, Bemerkung und die Ad-hoc-Angaben. */
export type DispositionPatch = AngabenPatch & { status_id?: number; bemerkung?: string | null };

/**
 * Ändert eine Disposition. `erwartet` trägt die Werte beim Öffnen (Feld-CAS, LLH-1945): hat ein
 * anderer eine dieser Angaben inzwischen geändert, antwortet der Server 409 `veraltet`. Die Antwort
 * ist das Fahrzeug; bei einem echten Statuswechsel trägt sie zusätzlich den Beleg
 * `status_ruecknahme` für „Rückgängig“ (LLH-1781, {@link nimmStatuswechselZurueck}).
 */
export function updateDisposition(
  einsatzId: number,
  efId: number,
  felder: DispositionPatch,
  erwartet?: Partial<Omit<DispositionPatch, 'status_id'>>,
): Promise<FahrzeugPatchAntwort> {
  return apiSend<FahrzeugPatchAntwort>(
    `/api/incidents/${einsatzId}/vehicles/${efId}`,
    'PATCH',
    erwartet ? { ...felder, erwartet } : felder,
  );
}

/**
 * „Rückgängig“ nach einem Statuswechsel (LLH-1781, Spec `fahrzeugstatus-quittung`): Status und
 * „seit“ von davor, das Zeitachsen-Ereignis gestrichen. Nur direkt danach und nur für die Person,
 * die gewechselt hat; inzwischen geändert → 409 `veraltet`, sonst 409 mit Grund.
 */
export function nimmStatuswechselZurueck(
  einsatzId: number,
  efId: number,
  beleg: StatusRuecknahmeBeleg,
): Promise<EinsatzFahrzeug> {
  return apiSend<EinsatzFahrzeug>(
    `/api/incidents/${einsatzId}/vehicles/${efId}/status/undo`,
    'POST',
    beleg,
  );
}

/** Entlassene Fahrzeuge des Einsatzes (LLH-1079 Teil II, Block „Entlassen“). */
export function listEntlasseneFahrzeuge(einsatzId: number): Promise<EinsatzFahrzeug[]> {
  return apiGet<EinsatzFahrzeug[]>(`/api/incidents/${einsatzId}/vehicles?entlassene=1`);
}

/**
 * Aus dem Einsatz entlassen (LLH-1079): die Zeile bleibt, Besatzung, Einheit,
 * Bereitstellungsraum, Führungsstelle und Beladung gehen. Die Antwort trägt den Vorzustand, mit
 * dem {@link nimmEntlassungZurueck} alles zurücknimmt (LLH-1722); deshalb ohne Rückfrage.
 */
export function entlasseDisposition(einsatzId: number, efId: number): Promise<EntlassungAntwort> {
  return apiSend<EntlassungAntwort>(
    `/api/incidents/${einsatzId}/vehicles/${efId}/stand-down`,
    'POST',
  );
}

/**
 * „Rückgängig“ nach dem Entlassen (LLH-1722, Spec `kraefte-entlassung`): stellt den Zustand
 * davor her; was inzwischen anders gebunden ist, steht in `ausgelassen`. Nur direkt danach und
 * nur für die entlassende Person, sonst 409; danach bleibt {@link reaktiviereDisposition}.
 */
export function nimmEntlassungZurueck(
  einsatzId: number,
  efId: number,
  vorzustand: EntlassungVorzustand,
): Promise<EntlassungRuecknahmeAntwort> {
  return apiSend<EntlassungRuecknahmeAntwort>(
    `/api/incidents/${einsatzId}/vehicles/${efId}/stand-down/undo`,
    'POST',
    vorzustand,
  );
}

/** Fehldisposition stornieren (LLH-1079): nur ohne Spur in den ersten 15 Minuten. */
export function storniereDisposition(einsatzId: number, efId: number): Promise<void> {
  return apiSend<void>(`/api/incidents/${einsatzId}/vehicles/${efId}/annul`, 'POST');
}

/** Ein entlassenes oder storniertes Fahrzeug erneut disponieren (Block „Entlassen“): neuer Anfangsstatus, keine Bindung. */
export function reaktiviereDisposition(einsatzId: number, efId: number): Promise<EinsatzFahrzeug> {
  return apiSend<EinsatzFahrzeug>(
    `/api/incidents/${einsatzId}/vehicles/${efId}/reactivate`,
    'POST',
  );
}

/** L‑2: Verortet ein Einsatzfahrzeug auf der Lagekarte; `erwartet` wie `verorteEinheit`. */
export function verorteFahrzeug(
  einsatzId: number,
  efId: number,
  daten: PositionPatch,
  erwartet?: PositionPatch,
): Promise<EinsatzFahrzeug> {
  return apiSend<EinsatzFahrzeug>(
    `/api/incidents/${einsatzId}/vehicles/${efId}/position`,
    'PATCH',
    erwartet ? { ...daten, erwartet } : daten,
  );
}

/**
 * LFH-9: Ordnet eine Kraft (einsatz_personal.id) einem Fahrzeug als Besatzung zu. Das Rückgängig
 * nach „Vom Fahrzeug lösen“ schickt `nurWennFrei` (LLH-1924): sitzt sie inzwischen auf einem
 * anderen Fahrzeug, 409 statt Umsetzen.
 */
export function ordneBesatzungZu(
  einsatzId: number,
  efId: number,
  epId: number,
  optionen?: Pick<ZuruecknahmeFilter, 'nurWennFrei'>,
): Promise<void> {
  return apiSend<void>(
    `/api/incidents/${einsatzId}/vehicles/${efId}/crew/${epId}${zuruecknahmeQuery(optionen)}`,
    'PUT',
  );
}

/**
 * Mehrere Kräfte (`einsatz_personal.id`) in einem Schritt als Besatzung zuordnen („Personal der
 * Einheit übernehmen“, LLH-1073, design.md D12): alles oder nichts, ein ETB-Eintrag. Eine
 * unbekannte oder entlassene Kraft lehnt der Server mit Grund je Person in `ApiError.zeilen` ab.
 */
export function zuordnenBesatzungMenge(
  einsatzId: number,
  efId: number,
  epIds: number[],
): Promise<void> {
  return apiSend<void>(`/api/incidents/${einsatzId}/vehicles/${efId}/crew`, 'POST', {
    ep_ids: epIds,
  });
}

/** LFH-9: Gibt eine Kraft aus der Fahrzeug-Besatzung frei. */
export function gibBesatzungFrei(einsatzId: number, efId: number, epId: number): Promise<void> {
  return apiSend<void>(`/api/incidents/${einsatzId}/vehicles/${efId}/crew/${epId}`, 'DELETE');
}
