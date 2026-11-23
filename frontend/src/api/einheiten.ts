import type {
  AusVorlageEingabe,
  AusVorlageErgebnis,
  Einheit,
  EinheitenAusNachforderungEingabe,
  EinheitStatusAntwort,
  HandStatusRuecknahmeBeleg,
  Nachforderung,
  NeueVerbindung,
  QualiSollEingabe,
  UebernahmeBody,
  VorlageVorschau,
} from './types';
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
  /** LLH-1553: eigenes Qualifikationssoll; `[]` = keins, es gilt das des Typs. */
  quali_soll?: QualiSollEingabe[] | null;
  bemerkung?: string | null;
  /** LFH-614: eigener Funkrufname der Einheit (Freitext, `null` leert). */
  funkrufname?: string | null;
  sortier?: number;
  /** LFH-109: IDs der zuzuordnenden Sprechgruppen aus dem Katalog. */
  sprechgruppe_ids?: number[];
  /**
   * LLH-1134: Telefon und weitere Verbindungen (personenbezogen); ersetzt die Liste vollständig
   * (`[]` leert). `kommunikationsmittel`/`erreichbarkeit` lehnt der Server mit 400 ab.
   */
  verbindungen?: NeueVerbindung[];
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

/**
 * L‑2: Verortet eine Einheit auf der Lagekarte. `erwartet` = gespeicherter Stand zu Beginn der
 * Handlung (Feld-CAS, LLH-1945; Koordinate nur als Paar): weicht er ab, antwortet der Server 409
 * `veraltet`. Ohne `erwartet` schreibt er ohne Vergleich.
 */
export function verorteEinheit(
  einsatzId: number,
  einheitId: number,
  daten: PositionPatch,
  erwartet?: PositionPatch,
): Promise<Einheit> {
  return apiSend<Einheit>(
    `/api/einsaetze/${einsatzId}/einheiten/${einheitId}/position`,
    'PATCH',
    erwartet ? { ...daten, erwartet } : daten,
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
  /** Wert desselben Felds beim Öffnen (Feld-CAS, LLH-1945); ohne ihn kein Vergleich. */
  erwartet?: string | null,
): Promise<Einheit> {
  const feld =
    'tz_fachaufgabe' in patch && patch.tz_fachaufgabe !== undefined
      ? 'tz_fachaufgabe'
      : 'tz_organisation';
  const body: PositionPatch = { [feld]: patch[feld] ?? null };
  return verorteEinheit(
    einsatzId,
    eid,
    body,
    erwartet === undefined ? undefined : { [feld]: erwartet },
  );
}

export function bildeEinheit(einsatzId: number, daten: EinheitEingabe): Promise<Einheit> {
  return apiSend<Einheit>(`/api/einsaetze/${einsatzId}/einheiten`, 'POST', daten);
}

/**
 * Eine eingetroffene Nachforderung als Einheit übernehmen (LLH-1383, Spec
 * `nachforderung-einheit`): neue Einheiten anlegen oder bestehende verknüpfen, auf Wunsch in den
 * Bereitstellungsraum des Ziels buchen. Antwortet mit der Nachforderung (trägt `einheit_ids`).
 */
export function uebernehmeAusNachforderung(
  einsatzId: number,
  eingabe: EinheitenAusNachforderungEingabe,
): Promise<Nachforderung> {
  return apiSend<Nachforderung>(
    `/api/einsaetze/${einsatzId}/einheiten/aus-nachforderung`,
    'POST',
    eingabe,
  );
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
 * `null` leert. Für Einzelfelder ohne Formular, etwa der Funkrufname aus der
 * Fernmeldeskizze (LFH-893). Ohne `sprechgruppe_ids`: die Sprechgruppen gehen einzeln
 * (`ordneEinheitSprechgruppeZu`/`loeseEinheitSprechgruppe`, LLH-1265 D4), damit kein Speichern
 * die Zuordnung eines anderen Arbeitsplatzes überschreibt.
 */
export type EinheitPatch = Partial<Omit<EinheitEingabe, 'sprechgruppe_ids'>>;

export function patcheEinheit(
  einsatzId: number,
  eid: number,
  patch: EinheitPatch,
  /** Werte beim Öffnen (Feld-CAS, LLH-1831, Spec `einheit-ansicht`); ohne kein Vergleich. */
  erwartet?: Partial<EinheitPatch>,
): Promise<Einheit> {
  return apiSend<Einheit>(
    `/api/einsaetze/${einsatzId}/einheiten/${eid}`,
    'PATCH',
    erwartet ? { ...patch, erwartet } : patch,
  );
}

/**
 * Eine Sprechgruppe der Einheit zuordnen (LLH-1265): idempotent, `204`; eine wirksame Zuordnung
 * schreibt der Server als System-Eintrag ins ETB.
 */
export function ordneEinheitSprechgruppeZu(
  einsatzId: number,
  eid: number,
  sprechgruppeId: number,
): Promise<void> {
  return apiSend<void>(
    `/api/einsaetze/${einsatzId}/einheiten/${eid}/sprechgruppen/${sprechgruppeId}`,
    'PUT',
  );
}

/** Die Zuordnung einer Sprechgruppe lösen (LLH-1265): idempotent, `204`, ETB wie beim Zuordnen. */
export function loeseEinheitSprechgruppe(
  einsatzId: number,
  eid: number,
  sprechgruppeId: number,
): Promise<void> {
  return apiSend<void>(
    `/api/einsaetze/${einsatzId}/einheiten/${eid}/sprechgruppen/${sprechgruppeId}`,
    'DELETE',
  );
}

/**
 * Einheit auflösen (LLH-1079): Kräfte werden frei, die Einheit bleibt mit Zeitachse und
 * ETB-Bezug als aufgelöst im Nachweis; ohne jede Spur löscht der Server sie.
 */
export function loeseEinheitAuf(einsatzId: number, eid: number): Promise<void> {
  return apiSend<void>(`/api/einsaetze/${einsatzId}/einheiten/${eid}`, 'DELETE');
}

/**
 * Eine unangemeldet erfasste Einheit übernehmen (LLH-1075, design.md D10): Kennzeichen weg,
 * Meldung des Eintreffens bestätigt, optional Abschnitt und Über-Einheit; sie bleibt im Raum.
 */
export function uebernehmeEinheit(
  einsatzId: number,
  eid: number,
  daten: UebernahmeBody,
): Promise<Einheit> {
  return apiSend<Einheit>(
    `/api/einsaetze/${einsatzId}/einheiten/${eid}/uebernehmen`,
    'POST',
    daten,
  );
}

/**
 * Eine unangemeldet erfasste Einheit abweisen (LLH-1075, design.md D11): sie verlässt den Raum,
 * wird aufgelöst, ihre Fahrzeuge werden entlassen. Unumkehrbar.
 */
export function weiseEinheitAb(einsatzId: number, eid: number): Promise<void> {
  return apiSend<void>(`/api/einsaetze/${einsatzId}/einheiten/${eid}/abweisen`, 'POST');
}

/** Aufgelöste Einheiten des Einsatzes (LLH-1079, Block „Aufgelöst“). */
export function listAufgeloesteEinheiten(einsatzId: number): Promise<Einheit[]> {
  return apiGet<Einheit[]>(`/api/einsaetze/${einsatzId}/einheiten?aufgeloeste=1`);
}

/**
 * Fehlübernahme aus einer Nachforderung stornieren (LLH-1388, design.md D3): der Verweis entfällt,
 * eine dabei angelegte Einheit wird aufgelöst (samt Austritt aus dem Raum), eine verknüpfte
 * verlässt nur den Raum, den die Übernahme gebucht hat. Antwort ist die Nachforderung.
 */
export function storniereUebernahme(einsatzId: number, eid: number): Promise<Nachforderung> {
  return apiSend<Nachforderung>(
    `/api/einsaetze/${einsatzId}/einheiten/${eid}/uebernahme-stornieren`,
    'POST',
  );
}

/** Fehlanlage stornieren (LLH-1079): nur eine Einheit ohne jede Spur, sie wird gelöscht. */
export function storniereEinheit(einsatzId: number, eid: number): Promise<void> {
  return apiSend<void>(`/api/einsaetze/${einsatzId}/einheiten/${eid}/stornieren`, 'POST');
}

/**
 * Vorbedingungen des Rückgängig nach „Aus Einheit lösen“ (LLH-1722, Spec `einheit-ansicht`) und
 * nach jedem anderen Lösen (LLH-1924, Spec `bedien-muster`, „Rückgängig nimmt nichts woanders
 * weg“): `nurWennFrei` lehnt mit 409 ab, statt den Datensatz einem anderen Ort still zu nehmen;
 * `alsFuehrer` setzt eine Person in derselben Transaktion wieder als Einheitsführer ein.
 */
export interface ZuruecknahmeFilter {
  nurWennFrei?: boolean;
  alsFuehrer?: boolean;
}

export function zuruecknahmeQuery(o: ZuruecknahmeFilter = {}): string {
  const q = new URLSearchParams();
  if (o.nurWennFrei) q.set('nur_wenn_frei', '1');
  if (o.alsFuehrer) q.set('als_fuehrer', '1');
  const text = q.toString();
  return text ? `?${text}` : '';
}

export function ordnePersonalZu(
  einsatzId: number,
  eid: number,
  epId: number,
  optionen?: ZuruecknahmeFilter,
): Promise<void> {
  return apiSend<void>(
    `/api/einsaetze/${einsatzId}/einheiten/${eid}/personal/${epId}${zuruecknahmeQuery(optionen)}`,
    'PUT',
  );
}

export function gibPersonalFrei(einsatzId: number, eid: number, epId: number): Promise<void> {
  return apiSend<void>(`/api/einsaetze/${einsatzId}/einheiten/${eid}/personal/${epId}`, 'DELETE');
}

export function ordneFahrzeugZu(
  einsatzId: number,
  eid: number,
  efId: number,
  optionen?: Pick<ZuruecknahmeFilter, 'nurWennFrei'>,
): Promise<void> {
  return apiSend<void>(
    `/api/einsaetze/${einsatzId}/einheiten/${eid}/fahrzeug/${efId}${zuruecknahmeQuery(optionen)}`,
    'PUT',
  );
}

export function gibFahrzeugFrei(einsatzId: number, eid: number, efId: number): Promise<void> {
  return apiSend<void>(`/api/einsaetze/${einsatzId}/einheiten/${eid}/fahrzeug/${efId}`, 'DELETE');
}

/**
 * Handstatus einer Einheit OHNE Fahrzeug setzen oder löschen (`null`, LFH-609). Mit
 * Fahrzeugen führen diese den Status — der Server antwortet dann 422. Bei einem echten Wechsel
 * trägt die Antwort den Beleg `status_ruecknahme` für „Rückgängig“ (LLH-1986).
 */
export function setzeEinheitStatus(
  einsatzId: number,
  eid: number,
  statusId: number | null,
): Promise<EinheitStatusAntwort> {
  return apiSend<EinheitStatusAntwort>(
    `/api/einsaetze/${einsatzId}/einheiten/${eid}/status`,
    'PUT',
    { status_id: statusId },
  );
}

/**
 * „Rückgängig“ nach einem Wechsel des Handstatus, auch nach dem Löschen (LLH-1986): Status und
 * „seit“ von davor. Nur direkt danach und nur für die Person, die gewechselt hat; inzwischen
 * geändert → 409 `veraltet`, sonst 409 mit Grund (etwa: inzwischen führen Fahrzeuge).
 */
export function nimmEinheitStatuswechselZurueck(
  einsatzId: number,
  eid: number,
  beleg: HandStatusRuecknahmeBeleg,
): Promise<Einheit> {
  return apiSend<Einheit>(
    `/api/einsaetze/${einsatzId}/einheiten/${eid}/status/zuruecknehmen`,
    'POST',
    beleg,
  );
}
