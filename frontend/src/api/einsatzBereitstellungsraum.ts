import type {
  Bereitstellungsraum,
  BrAbrufErgebnis,
  BrDetail,
  BrBelegung,
  BrListenEintrag,
  BrStatus,
  BrVerlaufEintrag,
  ObjektTyp,
  BrBelegungsArt,
} from './types';
import { apiGet, apiSend, mitParametern } from './client';

// ---------- Bereitstellungsräume ----------

/** Räume mit Abschnittsname, Kennzahlen der Belegung und Einheiten im Raum (LLH-1095). */
export function listeBr(
  einsatzId: number,
  status?: BrStatus,
  abschnittId?: number,
): Promise<BrListenEintrag[]> {
  return apiGet<BrListenEintrag[]>(
    mitParametern(`/api/einsaetze/${einsatzId}/bereitstellungsraeume`, {
      status,
      abschnitt_id: abschnittId,
    }),
  );
}

export function ladeBr(einsatzId: number, brId: number): Promise<BrDetail> {
  return apiGet<BrDetail>(`/api/einsaetze/${einsatzId}/bereitstellungsraeume/${brId}`);
}

/** Belegungsreihe eines Raums, ungeblättert, neueste zuerst (LLH-1095). */
export function loadBrVerlauf(einsatzId: number, brId: number): Promise<BrVerlaufEintrag[]> {
  return apiGet<BrVerlaufEintrag[]>(
    `/api/einsaetze/${einsatzId}/bereitstellungsraeume/${brId}/verlauf`,
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
  return apiSend<Bereitstellungsraum>(
    `/api/einsaetze/${einsatzId}/bereitstellungsraeume`,
    'POST',
    daten,
  );
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
}

export function aktualisiereBr(
  einsatzId: number,
  brId: number,
  daten: BrPatch,
): Promise<Bereitstellungsraum> {
  return apiSend<Bereitstellungsraum>(
    `/api/einsaetze/${einsatzId}/bereitstellungsraeume/${brId}`,
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
    `/api/einsaetze/${einsatzId}/bereitstellungsraeume/${brId}/status`,
    'POST',
    { status },
  );
}

export function storniereBr(einsatzId: number, brId: number): Promise<void> {
  return apiSend<void>(`/api/einsaetze/${einsatzId}/bereitstellungsraeume/${brId}`, 'DELETE');
}

/** Eintritt, Wechsel und Austritt; Abruf und Rücknahme haben eigene Routen (LLH-1085). */
interface BrBelegungEingabe {
  objekt_typ: ObjektTyp;
  objekt_id: number;
  art: Exclude<BrBelegungsArt, 'abruf' | 'abruf_aufgehoben'>;
  notiz?: string | null;
}

export function belegeBr(
  einsatzId: number,
  brId: number,
  daten: BrBelegungEingabe,
): Promise<BrBelegung> {
  return apiSend<BrBelegung>(
    `/api/einsaetze/${einsatzId}/bereitstellungsraeume/${brId}/belegung`,
    'POST',
    daten,
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
    `/api/einsaetze/${einsatzId}/bereitstellungsraeume/${brId}/abruf`,
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
    `/api/einsaetze/${einsatzId}/bereitstellungsraeume/${brId}/abruf/aufheben`,
    'POST',
    daten,
  );
}
