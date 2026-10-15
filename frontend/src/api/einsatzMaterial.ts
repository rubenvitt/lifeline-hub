import type { EinsatzMaterial, MaterialArt, MaterialStatus } from './types';
import { apiGet, apiSend } from './client';

export interface MaterialAdhocEingabe {
  bezeichnung: string;
  kategorie?: string | null;
  bestandsnummer?: string | null;
  traegerorganisation?: string | null;
}

export function listEinsatzMaterial(einsatzId: number): Promise<EinsatzMaterial[]> {
  return apiGet<EinsatzMaterial[]>(`/api/einsaetze/${einsatzId}/material`);
}

/**
 * Der eine Ort eines Postens (LLH-1224, design.md D7): höchstens ein Feld mit Wert, sonst 422.
 * Im PATCH heißt ein Wert „dorthin“ (der bisherige Ort geht), `null` „von diesem Ort lösen“.
 */
export interface MaterialOrtPatch {
  einheit_id?: number | null;
  einsatz_fahrzeug_id?: number | null;
  uhs_id?: number | null;
  br_id?: number | null;
}

/** Optionen beim Disponieren: ein Ort (alle Ortsarten) und bei Ad-hoc die Art (LLH-1224). */
export interface DisponierEingabe {
  ort?: MaterialOrtPatch;
  /**
   * Übernahme aus einer eingetroffenen Nachforderung (LLH-1226 D1): der Posten verweist auf sie.
   * Trägt sie schon einen nicht stornierten Posten, lehnt der Server ohne `ergaenzen` mit 409 ab
   * (D3); `ergaenzen` geht nur als `true` auf den Draht.
   */
  nachforderungId?: number;
  ergaenzen?: boolean;
}

/** Die Felder des Bezugs im POST-Körper; ohne Bezug keine. */
function bezugFelder(o: DisponierEingabe) {
  return {
    ...(o.nachforderungId != null ? { nachforderung_id: o.nachforderungId } : {}),
    ...(o.ergaenzen ? { ergaenzen: true } : {}),
  };
}

export function disponiereMaterial(
  einsatzId: number,
  materialId: number,
  menge: number,
  optionen: DisponierEingabe = {},
): Promise<EinsatzMaterial> {
  return apiSend<EinsatzMaterial>(`/api/einsaetze/${einsatzId}/material`, 'POST', {
    material_id: materialId,
    menge,
    ...optionen.ort,
    ...bezugFelder(optionen),
  });
}

// menge wird separat übergeben, da es keine Stamm-Eigenschaft des Ad-hoc-Materials ist. Ohne
// `art` leitet der Server sie aus der Menge ab (Menge 1 → Gerät).
export function disponiereAdhoc(
  einsatzId: number,
  adhoc: MaterialAdhocEingabe,
  menge: number,
  optionen: DisponierEingabe & { art?: MaterialArt } = {},
): Promise<EinsatzMaterial> {
  return apiSend<EinsatzMaterial>(`/api/einsaetze/${einsatzId}/material`, 'POST', {
    adhoc,
    menge,
    ...(optionen.art ? { art: optionen.art } : {}),
    ...optionen.ort,
    ...bezugFelder(optionen),
  });
}

/**
 * Felder des Material-PATCH (LLH-1093, LLH-1224). Fehlend heißt unverändert, `null` leert. Die
 * vier Ad-hoc-Angaben nimmt der Server nur an einem Ad-hoc-Posten an (sonst 422 „im Stamm
 * pflegen“); `bezeichnung` ist Pflicht und nie `null`. `ausgegeben` ist der neue Gesamtwert der
 * Ausgabe eines Verbrauchsguts; die Regeln der Ergebniszeile prüft der Server (422 mit Grund).
 */
export interface MaterialPatch extends MaterialOrtPatch {
  menge?: number;
  ausgegeben?: number;
  status?: MaterialStatus;
  art?: MaterialArt;
  bemerkung?: string;
  bezeichnung?: string;
  kategorie?: string | null;
  bestandsnummer?: string | null;
  traegerorganisation?: string | null;
}

export function updateDisposition(
  einsatzId: number,
  emId: number,
  felder: MaterialPatch,
): Promise<EinsatzMaterial> {
  return apiSend<EinsatzMaterial>(`/api/einsaetze/${einsatzId}/material/${emId}`, 'PATCH', felder);
}

/**
 * Einen Posten aufteilen (LLH-1093, design.md D8): `menge` geht als neue Zeile mit denselben
 * Angaben, demselben Ort und Status ab, die Ausgangszeile behält den Rest. Antwort `[Ausgang, neu]`.
 */
export function teileAuf(
  einsatzId: number,
  emId: number,
  menge: number,
): Promise<[EinsatzMaterial, EinsatzMaterial]> {
  return apiSend<[EinsatzMaterial, EinsatzMaterial]>(
    `/api/einsaetze/${einsatzId}/material/${emId}/aufteilen`,
    'POST',
    { menge },
  );
}

/**
 * Aus dem Einsatz genommenes Material (LLH-1079 Teil II, Block „Aus dem Einsatz genommen“). Auf
 * dem Draht heißt der Endzustand wie bei jeder Kraft `entlassen`.
 */
export function listEntlassenesMaterial(einsatzId: number): Promise<EinsatzMaterial[]> {
  return apiGet<EinsatzMaterial[]>(`/api/einsaetze/${einsatzId}/material?entlassene=1`);
}

/**
 * Aus dem Einsatz nehmen (LLH-1079, Wortlaut LLH-1093): die Zeile bleibt, der Ort geht.
 * Umkehrbar über {@link reaktiviereDisposition}, deshalb ohne Rückfrage.
 */
export function nimmAusDemEinsatz(einsatzId: number, emId: number): Promise<EinsatzMaterial> {
  return apiSend<EinsatzMaterial>(`/api/einsaetze/${einsatzId}/material/${emId}/entlassen`, 'POST');
}

/** Fehldisposition stornieren (LLH-1079): nur ohne Ort (LLH-1224) in den ersten 15 Minuten. */
export function storniereDisposition(einsatzId: number, emId: number): Promise<void> {
  return apiSend<void>(`/api/einsaetze/${einsatzId}/material/${emId}/stornieren`, 'POST');
}

/** Herausgenommenes oder storniertes Material erneut disponieren (Rückgängig, Block). */
export function reaktiviereDisposition(einsatzId: number, emId: number): Promise<EinsatzMaterial> {
  return apiSend<EinsatzMaterial>(
    `/api/einsaetze/${einsatzId}/material/${emId}/reaktivieren`,
    'POST',
  );
}

// Den Ort eines Postens schreibt nur der Material-PATCH (`updateDisposition`, LLH-1225 D2). Die
// Einheiten-Routen `PUT/DELETE …/einheiten/{eid}/material/{em_id}` haben im Client keinen Aufrufer.
