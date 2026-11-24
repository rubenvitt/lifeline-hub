import type {
  Bereitstellungsraum,
  BrAbrufErgebnis,
  BrDetail,
  BrBelegung,
  BrListenEintrag,
  BrStatus,
  BrVerlaufEintrag,
  EintreffenEingabe,
  EintreffenErgebnis,
  ErwarteteKraft,
  ObjektTyp,
  StammTreffer,
  BrBelegungsArt,
} from './types';
import { apiGet, apiSend, mitParametern, type ApiSendOptionen } from './client';

// ---------- Bereitstellungsräume ----------

/** Räume mit Abschnittsname, Kennzahlen der Belegung und Einheiten im Raum (LLH-1095). */
export function listeBr(
  einsatzId: number,
  status?: BrStatus,
  abschnittId?: number,
): Promise<BrListenEintrag[]> {
  return apiGet<BrListenEintrag[]>(
    mitParametern(`/api/einsaetze/${einsatzId}/staging-areas`, {
      status,
      abschnitt_id: abschnittId,
    }),
  );
}

export function ladeBr(einsatzId: number, brId: number): Promise<BrDetail> {
  return apiGet<BrDetail>(`/api/einsaetze/${einsatzId}/staging-areas/${brId}`);
}

/** Belegungsreihe eines Raums, ungeblättert, neueste zuerst (LLH-1095). */
export function loadBrVerlauf(einsatzId: number, brId: number): Promise<BrVerlaufEintrag[]> {
  return apiGet<BrVerlaufEintrag[]>(`/api/einsaetze/${einsatzId}/staging-areas/${brId}/history`);
}

/**
 * Erwartete Kräfte aus Nachforderungen mit Ziel = dieser Raum (LLH-1387): nur Art, Anzahl, Stufe,
 * offene Rufnamen und erwartetes Eintreffen. Ohne Freigabe Nachforderungen 403.
 */
export function loadBrErwartet(einsatzId: number, brId: number): Promise<ErwarteteKraft[]> {
  return apiGet<ErwarteteKraft[]>(`/api/einsaetze/${einsatzId}/staging-areas/${brId}/expected`);
}

/**
 * Einheiten-Vorlagen der Organisation als Treffer für „Eintreffen buchen“ (LLH-1300): ab drei
 * Zeichen, höchstens zehn, nur Namen und Funkrufnamen. Das Gerät des Raums liest so, ohne den
 * Stammdaten-Katalog lesen zu dürfen.
 */
export function loadBrStammTreffer(
  einsatzId: number,
  brId: number,
  suche: string,
): Promise<StammTreffer[]> {
  return apiGet<StammTreffer[]>(
    mitParametern(`/api/einsaetze/${einsatzId}/staging-areas/${brId}/master-data-matches`, {
      suche,
    }),
  );
}

export interface BrEingabe {
  bezeichnung: string;
  abschnitt_id?: number | null;
  standort?: string | null;
  notiz?: string | null;
  /** Koordinate (LLH-1107): beide oder keine, sonst 422. */
  lat?: number | null;
  lon?: number | null;
}

export function legeBrAn(einsatzId: number, daten: BrEingabe): Promise<Bereitstellungsraum> {
  return apiSend<Bereitstellungsraum>(`/api/einsaetze/${einsatzId}/staging-areas`, 'POST', daten);
}

/** Teil-Patch der Raumdaten: fehlender Key = unverändert, `null` = leeren (`patchTriState.ts`). */
export interface BrPatch {
  bezeichnung?: string;
  abschnitt_id?: number | null;
  standort?: string | null;
  notiz?: string | null;
  /** Koordinate (LLH-1107): beide `null` entfernen die Verortung; ein halbes Paar ist 422. */
  lat?: number | null;
  lon?: number | null;
  /**
   * Optimistisches Lock (LLH-1920): `geaendert_at` beim Öffnen; ein anderer Stand gibt 409. Fehlt
   * er, schreibt der Server ohne Prüfung.
   */
  basis_geaendert_at?: string;
}

export function aktualisiereBr(
  einsatzId: number,
  brId: number,
  daten: BrPatch,
): Promise<Bereitstellungsraum> {
  return apiSend<Bereitstellungsraum>(
    `/api/einsaetze/${einsatzId}/staging-areas/${brId}`,
    'PATCH',
    daten,
  );
}

export function setzeBrStatus(
  einsatzId: number,
  brId: number,
  status: BrStatus,
): Promise<Bereitstellungsraum> {
  return apiSend<Bereitstellungsraum>(
    `/api/einsaetze/${einsatzId}/staging-areas/${brId}/status`,
    'POST',
    { status },
  );
}

export function storniereBr(einsatzId: number, brId: number): Promise<void> {
  return apiSend<void>(`/api/einsaetze/${einsatzId}/staging-areas/${brId}`, 'DELETE');
}

/** Eintritt, Wechsel und Austritt; Abruf und Rücknahme haben eigene Routen (LLH-1085). */
interface BrBelegungEingabe {
  objekt_typ: ObjektTyp;
  objekt_id: number;
  art: Exclude<BrBelegungsArt, 'abruf' | 'abruf_aufgehoben'>;
  notiz?: string | null;
  /**
   * Nur bei `wechsel`: der Raum, aus dem verlegt wird. Steht die Kraft inzwischen woanders, lehnt
   * der Server mit 409 ab, statt still aus dem neuen Raum zu wechseln (LLH-1521).
   */
  von_br_id?: number;
}

export function belegeBr(
  einsatzId: number,
  brId: number,
  daten: BrBelegungEingabe,
): Promise<BrBelegung> {
  return apiSend<BrBelegung>(
    `/api/einsaetze/${einsatzId}/staging-areas/${brId}/occupancy`,
    'POST',
    daten,
  );
}

/**
 * Nimmt einen Austritt zurück (LLH-1924, Spec `bereitstellungsraum-belegung`, „Austritt
 * zurücknehmen“): die Kraft steht wieder im Raum, ihre Wartezeit läuft weiter. 409 mit Grund,
 * wenn sie inzwischen weiter gebucht ist oder das Austragen zu lange zurückliegt.
 */
export function nimmBrAustrittZurueck(
  einsatzId: number,
  brId: number,
  belegungId: number,
): Promise<BrBelegung> {
  return apiSend<BrBelegung>(
    `/api/einsaetze/${einsatzId}/staging-areas/${brId}/occupancy/${belegungId}/undo`,
    'POST',
  );
}

/**
 * Eintreffen buchen (LLH-1075, design.md D1): eine bekannte Kraft (`kraft`) oder eine
 * unangemeldete (`unangemeldet`), genau eines von beiden. Eintritt, Zeitachse, ETB und bei einer
 * unangemeldeten Kraft die Meldung an die Einsatzleitung entstehen beim Server in einem Schritt.
 */
export function bucheEintreffen(
  einsatzId: number,
  brId: number,
  daten: EintreffenEingabe,
  optionen?: ApiSendOptionen,
): Promise<EintreffenErgebnis> {
  return apiSend<EintreffenErgebnis>(
    `/api/einsaetze/${einsatzId}/staging-areas/${brId}/arrival`,
    'POST',
    daten,
    optionen,
  );
}

/** Body von `POST …/abruf` (handgepflegt, LLH-1085). */
export interface BrAbrufEingabe {
  objekt_typ: ObjektTyp;
  objekt_id: number;
  /** Ziel-Abschnitt; nur für Einheiten. */
  abschnitt_id?: number | null;
  /** Auftrag an die Kraft; leer heißt „kein Auftrag“. */
  auftrag_text?: string | null;
  /** Abruf und Austritt in einem Schritt („Rückt sofort aus“). */
  ausgerueckt?: boolean;
}

/** Ruft eine Kraft aus dem Raum ab, wahlweise mit Ziel-Abschnitt und Auftrag (LLH-1085). */
export function ruftAbAusBr(
  einsatzId: number,
  brId: number,
  daten: BrAbrufEingabe,
): Promise<BrAbrufErgebnis> {
  return apiSend<BrAbrufErgebnis>(
    `/api/einsaetze/${einsatzId}/staging-areas/${brId}/dispatch`,
    'POST',
    daten,
  );
}

/** Body von `POST …/abruf/aufheben` (handgepflegt, LLH-1085). */
export interface BrAbrufAufhebenEingabe {
  objekt_typ: ObjektTyp;
  objekt_id: number;
}

/** Nimmt den offenen Abruf einer Kraft zurück; ein erteilter Auftrag bleibt (LLH-1085). */
export function hebtBrAbrufAuf(
  einsatzId: number,
  brId: number,
  daten: BrAbrufAufhebenEingabe,
): Promise<BrBelegung> {
  return apiSend<BrBelegung>(
    `/api/einsaetze/${einsatzId}/staging-areas/${brId}/dispatch/void`,
    'POST',
    daten,
  );
}
