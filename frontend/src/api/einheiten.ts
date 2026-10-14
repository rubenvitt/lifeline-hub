import type { AusVorlageEingabe, AusVorlageErgebnis, Einheit, VorlageVorschau } from './types';
import { apiGet, apiSend } from './client';

export interface EinheitEingabe {
  name: string;
  abschnitt_id?: number | null;
  ueber_einheit_id?: number | null;
  typ_id?: number | null;
  fuehrer_id?: number | null;
  soll_fuehrer?: number | null;
  soll_unterfuehrer?: number | null;
  soll_mannschaft?: number | null;
  bemerkung?: string | null;
  /** LFH-614: eigener Funkrufname der Einheit (Freitext, `null` leert). */
  funkrufname?: string | null;
  sortier?: number;
  /** LFH-109: IDs der zuzuordnenden Sprechgruppen aus dem Katalog. */
  sprechgruppe_ids?: number[];
  /** LFH-108: Funk/Kommunikation — Freitext-Schlüssel (digitalfunk/mobil/festnetz). */
  kommunikationsmittel?: string | null;
  /** LFH-108: Funk/Kommunikation — Rufnummer/Freitext (PII). */
  erreichbarkeit?: string | null;
  /**
   * LLH-1073: disponierte Fahrzeuge (`EinsatzFahrzeug.id`), die der neuen Einheit angehören
   * („Als eigene Einheit führen“); ihre Besatzung ohne Einheit kommt mit. Ein schon zugeordnetes
   * oder beendetes Fahrzeug lehnt der Server mit Grund je Fahrzeug in `ApiError.zeilen` ab.
   */
  fahrzeug_ids?: number[];
}

export function listeEinheiten(einsatzId: number): Promise<Einheit[]> {
  return apiGet<Einheit[]>(`/api/einsaetze/${einsatzId}/einheiten`);
}

/** L‑2: Geo-Verortung eines taktischen Objekts. Felder werden nur gesendet, wenn
 *  gesetzt; `null` löscht explizit. lat/lon gehören zusammen (beide Zahl = setzen,
 *  beide null = löschen). */
export interface PositionPatch {
  lat?: number | null;
  lon?: number | null;
  tz_fachaufgabe?: string | null;
  tz_organisation?: string | null;
}

/** L‑2: Verortet eine Einheit auf der Lagekarte. */
export function verorteEinheit(
  einsatzId: number,
  einheitId: number,
  daten: PositionPatch,
): Promise<Einheit> {
  return apiSend<Einheit>(
    `/api/einsaetze/${einsatzId}/einheiten/${einheitId}/position`,
    'PATCH',
    daten,
  );
}

/**
 * Genau EIN Feld des taktischen Zeichens einer Einheit (LLH-1036, design.md D4). Die Typen lassen
 * keinen zweiten Schlüssel und keine Koordinate zu: `…/position` nähme auch `lat`/`lon`, und die
 * Einheit-Ansicht verschöbe sonst nebenbei die Verortung.
 */
export type EinheitZeichenPatch =
  | { tz_fachaufgabe: string | null; tz_organisation?: never }
  | { tz_organisation: string | null; tz_fachaufgabe?: never };

/**
 * Speichert Fachaufgabe ODER Organisation des Zeichens über den Lageweg, wie Inspector und Karte:
 * Tri-State am Server, kein Tagebuch-Eintrag, live über das Einheit-Ereignis. Der Body wird aus
 * dem einen Schlüssel neu gebaut, damit auch ein breiteres Objekt nichts anderes mitschickt.
 */
export function patchEinheitZeichen(
  einsatzId: number,
  eid: number,
  patch: EinheitZeichenPatch,
): Promise<Einheit> {
  const body: PositionPatch =
    'tz_fachaufgabe' in patch && patch.tz_fachaufgabe !== undefined
      ? { tz_fachaufgabe: patch.tz_fachaufgabe }
      : { tz_organisation: patch.tz_organisation ?? null };
  return verorteEinheit(einsatzId, eid, body);
}

export function bildeEinheit(einsatzId: number, daten: EinheitEingabe): Promise<Einheit> {
  return apiSend<Einheit>(`/api/einsaetze/${einsatzId}/einheiten`, 'POST', daten);
}

/**
 * Vorschau einer Einheiten-Vorlage im Einsatz (LLH-1049, Spec `einheit-vorlagen`, „Vorschau im
 * Einsatz“): der Baum der Vorlage und je Fahrzeug und Person der Zustand. Schreibt nichts.
 */
export function loadEinheitAusVorlage(
  einsatzId: number,
  vorlageId: number,
): Promise<VorlageVorschau> {
  return apiGet<VorlageVorschau>(`/api/einsaetze/${einsatzId}/einheiten/aus-vorlage/${vorlageId}`);
}

/**
 * Einheit samt Untereinheiten, Fahrzeugen und gewählter Stammbesetzung in einem Absenden bilden
 * (LLH-1049, Spec `kraefte-disposition`): alles oder nichts. Eine Ablehnung trägt die Gründe je
 * Kraft in `ApiError.zeilen`.
 */
export function createEinheitAusVorlage(
  einsatzId: number,
  eingabe: AusVorlageEingabe,
): Promise<AusVorlageErgebnis> {
  return apiSend<AusVorlageErgebnis>(
    `/api/einsaetze/${einsatzId}/einheiten/aus-vorlage`,
    'POST',
    eingabe,
  );
}

/**
 * Teiländerung einer Einheit (LFH-306, Tri-State): nur die übergebenen Schlüssel gehen hinaus,
 * `null` leert. Für Einzelfelder ohne Formular, etwa Funkrufname und Kommunikationsmittel aus der
 * Fernmeldeskizze (LFH-893).
 */
export type EinheitPatch = Partial<EinheitEingabe>;

export function patcheEinheit(
  einsatzId: number,
  eid: number,
  patch: EinheitPatch,
): Promise<Einheit> {
  return apiSend<Einheit>(`/api/einsaetze/${einsatzId}/einheiten/${eid}`, 'PATCH', patch);
}

/**
 * Einheit auflösen (LLH-1079): Kräfte werden frei, die Einheit bleibt mit Zeitachse und
 * ETB-Bezug als aufgelöst im Nachweis; ohne jede Spur löscht der Server sie.
 */
export function loeseEinheitAuf(einsatzId: number, eid: number): Promise<void> {
  return apiSend<void>(`/api/einsaetze/${einsatzId}/einheiten/${eid}`, 'DELETE');
}

/** Aufgelöste Einheiten des Einsatzes (LLH-1079, Block „Aufgelöst“). */
export function listAufgeloesteEinheiten(einsatzId: number): Promise<Einheit[]> {
  return apiGet<Einheit[]>(`/api/einsaetze/${einsatzId}/einheiten?aufgeloeste=1`);
}

/** Fehlanlage stornieren (LLH-1079): nur eine Einheit ohne jede Spur, sie wird gelöscht. */
export function storniereEinheit(einsatzId: number, eid: number): Promise<void> {
  return apiSend<void>(`/api/einsaetze/${einsatzId}/einheiten/${eid}/stornieren`, 'POST');
}

export function ordnePersonalZu(einsatzId: number, eid: number, epId: number): Promise<void> {
  return apiSend<void>(`/api/einsaetze/${einsatzId}/einheiten/${eid}/personal/${epId}`, 'PUT');
}

export function gibPersonalFrei(einsatzId: number, eid: number, epId: number): Promise<void> {
  return apiSend<void>(`/api/einsaetze/${einsatzId}/einheiten/${eid}/personal/${epId}`, 'DELETE');
}

export function ordneFahrzeugZu(einsatzId: number, eid: number, efId: number): Promise<void> {
  return apiSend<void>(`/api/einsaetze/${einsatzId}/einheiten/${eid}/fahrzeug/${efId}`, 'PUT');
}

export function gibFahrzeugFrei(einsatzId: number, eid: number, efId: number): Promise<void> {
  return apiSend<void>(`/api/einsaetze/${einsatzId}/einheiten/${eid}/fahrzeug/${efId}`, 'DELETE');
}

/**
 * Handstatus einer Einheit OHNE Fahrzeug setzen oder löschen (`null`, LFH-609). Mit
 * Fahrzeugen führen diese den Status — der Server antwortet dann 422.
 */
export function setzeEinheitStatus(
  einsatzId: number,
  eid: number,
  statusId: number | null,
): Promise<Einheit> {
  return apiSend<Einheit>(`/api/einsaetze/${einsatzId}/einheiten/${eid}/status`, 'PUT', {
    status_id: statusId,
  });
}
