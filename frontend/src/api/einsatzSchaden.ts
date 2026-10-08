import type {
  Schaden,
  SchadenAnhang,
  SchadenAuswahl,
  SchadenKennzahlen,
  SchadenMarker,
  SchadenStatus,
  SchadenTyp,
  Ausmass,
} from './types';
import {
  apiGet,
  apiSend,
  apiUploadMitFortschritt,
  mitParametern,
  type UploadFortschritt,
} from './client';
import { UPLOAD_TIMEOUT_MS } from './upload';
import { registrierNummer } from '../anzeige/registrierNummer';

/** Felder beim Anlegen (Typ + Ort + Ausmaß Pflicht; Rest optional). Geschädigt FK XOR Freitext. */
export interface SchadenEingabe {
  typ: SchadenTyp;
  ausmass: Ausmass;
  ort: string;
  beschreibung?: string | null;
  lat?: number | null;
  lon?: number | null;
  geschaedigt_person_id?: number | null;
  geschaedigt_personal_id?: number | null;
  geschaedigt_organisation_id?: number | null;
  geschaedigt_kontakt?: string | null;
}

/** Patch-Felder (nur Stammfelder + Audit-Felder; NICHT Status). Geschädigt-/Übergabe-Felder
 *  akzeptieren `null` = leeren (Toggle). */
export interface SchadenPatch {
  typ?: SchadenTyp;
  ausmass?: Ausmass;
  ort?: string;
  beschreibung?: string;
  geschaedigt_person_id?: number | null;
  geschaedigt_personal_id?: number | null;
  geschaedigt_organisation_id?: number | null;
  geschaedigt_kontakt?: string | null;
  uebergeben_an?: string | null;
  abschluss_grund?: string | null;
  lat?: number | null;
  lon?: number | null;
}

interface SchaedenListenFilter {
  status?: SchadenStatus;
  typ?: SchadenTyp;
  ausmass?: Ausmass;
  geschaedigtPersonId?: number;
  inklStorniert?: boolean;
}

/** Vollständige Liste, neueste Nummer zuerst: Druck, Einsatzbericht, Schäden je Person. */
export function listeSchaeden(
  einsatzId: number,
  filter: SchaedenListenFilter = {},
): Promise<Schaden[]> {
  return apiGet<Schaden[]>(
    mitParametern(`/api/einsaetze/${einsatzId}/schaeden`, {
      status: filter.status,
      typ: filter.typ,
      ausmass: filter.ausmass,
      geschaedigt_person_id: filter.geschaedigtPersonId,
      inkl_storniert: filter.inklStorniert,
    }),
  );
}

// ── Modulseite: seitenweise, Filter, Suche und Sortierung am Server (LFH-1075) ─────────────

/** Seitengröße der Modulseite; der Server klemmt auf `[1, 500]`. */
export const SCHAEDEN_SEITE = 100;

export type SchadenSortSpalte = 'nr' | 'typ' | 'ausmass' | 'ort' | 'erfasst' | 'verortet';
export interface SchadenSortierung {
  spalte: SchadenSortSpalte;
  richtung: 'ab' | 'auf';
}
export const SCHADEN_SORTIERUNG_VORGABE: SchadenSortierung = { spalte: 'nr', richtung: 'ab' };

/** Filter der Modulseite. Ein leeres Feld filtert nicht; mehrere Werte: einer muss zutreffen. */
export interface SchaedenFilter {
  status?: SchadenStatus;
  typen?: readonly SchadenTyp[];
  ausmasse?: readonly Ausmass[];
  verortet?: readonly ('ja' | 'nein')[];
  /** Suchbegriff, getrimmt; trifft als Teil Nummer, Ort, Beschreibung oder Geschädigten. */
  q?: string;
}

/** Position hinter dem letzten geladenen Schaden: Schlüsselwert (außer bei `nr`) und Nummer. */
export interface SchadenCursor {
  vor_wert?: string;
  vor_nr: number;
}

const AUSMASS_RANG: Record<Ausmass, number> = { gering: 0, mittel: 1, gross: 2, katastrophal: 3 };

const verortetWert = (s: { lat?: number | null; lon?: number | null }) =>
  s.lat != null && s.lon != null ? 1 : 0;

/** Groß-/Kleinschreibung nur für A–Z ohne Unterschied, wie SQLite `COLLATE NOCASE`. */
const nocase = (t: string) => t.replace(/[A-Z]/g, (c) => c.toLowerCase());

/** Schlüsselwert einer Zeile, wie der Server sortiert (`SortSpalte::ausdruck`). */
function schluessel(s: Schaden, spalte: SchadenSortSpalte): number | string {
  switch (spalte) {
    case 'nr':
      return s.registrier_nr;
    case 'typ':
      return s.typ;
    case 'ausmass':
      return AUSMASS_RANG[s.ausmass];
    case 'ort':
      return nocase(s.ort);
    case 'erfasst':
      return s.erfasst_at;
    case 'verortet':
      return verortetWert(s);
  }
}

/** Ordnung der Modulseite wie im SQL: Schlüssel, dann Nummer, beides in der Richtung. */
export function vergleicheSchaedenNach(
  sortierung: SchadenSortierung,
): (a: Schaden, b: Schaden) => number {
  const faktor = sortierung.richtung === 'ab' ? -1 : 1;
  return (a, b) => {
    const ka = schluessel(a, sortierung.spalte);
    const kb = schluessel(b, sortierung.spalte);
    if (ka !== kb) return (ka < kb ? -1 : 1) * faktor;
    return (a.registrier_nr - b.registrier_nr) * faktor;
  };
}

/** Cursor hinter der Zeile `s` in der Sortierung `spalte`. */
export function schadenCursor(s: Schaden, spalte: SchadenSortSpalte): SchadenCursor {
  if (spalte === 'nr') return { vor_nr: s.registrier_nr };
  // Der Ort geht roh an den Server; er vergleicht selbst ohne Unterschied der Schreibung.
  const wert = spalte === 'ort' ? s.ort : String(schluessel(s, spalte));
  return { vor_wert: wert, vor_nr: s.registrier_nr };
}

function sichtParameter(sicht: SchaedenFilter) {
  return {
    typ: sicht.typen?.join(','),
    ausmass: sicht.ausmasse?.join(','),
    verortet: sicht.verortet?.join(','),
    q: sicht.q?.trim(),
  };
}

/** Eine Seite der Modulseite. */
export function listeSchaedenSeite(
  einsatzId: number,
  sicht: SchaedenFilter,
  sortierung: SchadenSortierung,
  vor?: SchadenCursor,
  limit: number = SCHAEDEN_SEITE,
): Promise<Schaden[]> {
  return apiGet<Schaden[]>(
    mitParametern(`/api/einsaetze/${einsatzId}/schaeden`, {
      status: sicht.status,
      ...sichtParameter(sicht),
      sortierung: `${sortierung.spalte}_${sortierung.richtung}`,
      vor_wert: vor?.vor_wert,
      vor_nr: vor?.vor_nr,
      limit,
    }),
  );
}

/** Zahl der Schäden gesamt und je Status zu derselben Sicht, ohne deren Status. */
export function ladeSchadenKennzahlen(
  einsatzId: number,
  sicht: Omit<SchaedenFilter, 'status'>,
): Promise<SchadenKennzahlen> {
  return apiGet<SchadenKennzahlen>(
    mitParametern(`/api/einsaetze/${einsatzId}/schaeden/kennzahlen`, sichtParameter(sicht)),
  );
}

/**
 * Ob ein Schaden zur Sicht gehört, so wie der Server filtert. `null`, wenn ein Suchbegriff
 * gesetzt ist: dessen Treffer entscheidet nur der Server.
 */
export function passtZurSicht(s: Schaden, sicht: SchaedenFilter): boolean | null {
  if (sicht.q?.trim()) return null;
  if (s.storniert_at != null) return false;
  if (sicht.status && s.status !== sicht.status) return false;
  if (sicht.typen?.length && !sicht.typen.includes(s.typ)) return false;
  if (sicht.ausmasse?.length && !sicht.ausmasse.includes(s.ausmass)) return false;
  if (sicht.verortet?.length === 1) {
    if ((verortetWert(s) === 1) !== (sicht.verortet[0] === 'ja')) return false;
  }
  return true;
}

/**
 * Schadenauswahl für Auswahlfelder und Sprungpalette (LFH-1075): alle nicht stornierten, neueste
 * Nummer zuerst, ohne Beschreibung und ohne Geschädigten-Angaben; `frei` = kein Geschädigter.
 */
export function listeSchadenAuswahl(einsatzId: number): Promise<SchadenAuswahl[]> {
  return apiGet<SchadenAuswahl[]>(`/api/einsaetze/${einsatzId}/schaeden/auswahl`);
}

/** Die Auswahlzeile einer vollen Zeile; `null`, wenn sie nicht in die Auswahl gehört. */
export function alsSchadenAuswahl(s: Schaden): SchadenAuswahl | null {
  if (s.storniert_at != null) return null;
  return {
    id: s.id,
    registrier_nr: s.registrier_nr,
    status: s.status,
    typ: s.typ,
    ausmass: s.ausmass,
    ort: s.ort,
    frei:
      s.geschaedigt_person_id == null &&
      s.geschaedigt_personal_id == null &&
      s.geschaedigt_organisation_id == null &&
      s.geschaedigt_kontakt == null,
  };
}

/**
 * Schadenmarker für Lagekarte und Lage-Dashboard (LFH-931): Kennung, Nummer, Typ, Ausmaß,
 * Status und Lage aller nicht stornierten Schäden, neueste Nummer zuerst. Ohne Freitexte.
 */
export function listeSchadenMarker(einsatzId: number): Promise<SchadenMarker[]> {
  return apiGet<SchadenMarker[]>(`/api/einsaetze/${einsatzId}/schaeden/marker`);
}

/** Der Marker einer vollen Zeile; ein nachgeladener Schaden aktualisiert so auch die Karte. */
export function alsSchadenMarker(s: Schaden): SchadenMarker {
  return {
    id: s.id,
    registrier_nr: s.registrier_nr,
    status: s.status,
    typ: s.typ,
    ausmass: s.ausmass,
    lat: s.lat ?? null,
    lon: s.lon ?? null,
  };
}

/** Ordnung der Schadenliste und der Marker wie im SQL: neueste Registriernummer zuerst. */
export function vergleicheSchaeden(
  a: { registrier_nr: number },
  b: { registrier_nr: number },
): number {
  return b.registrier_nr - a.registrier_nr;
}

export function ladeSchaden(einsatzId: number, schadenId: number): Promise<Schaden> {
  return apiGet<Schaden>(`/api/einsaetze/${einsatzId}/schaeden/${schadenId}`);
}

export function legeSchadenAn(einsatzId: number, daten: SchadenEingabe): Promise<Schaden> {
  return apiSend<Schaden>(`/api/einsaetze/${einsatzId}/schaeden`, 'POST', daten);
}

/**
 * Optimistisches Lock: `basisGeaendertAt` trägt den beim Laden gelesenen `geaendert_at`-Stand;
 * veraltet → 409. Ohne Baseline (Lagekarten-Drag lat/lon, Geschädigt-Zuordnung aus der
 * Personen-Detailseite, Konfliktdialog-Overwrite) wird bewusst blind geschrieben.
 */
export function aktualisiereSchaden(
  einsatzId: number,
  schadenId: number,
  daten: SchadenPatch,
  basisGeaendertAt?: string,
): Promise<Schaden> {
  const body = basisGeaendertAt ? { ...daten, basis_geaendert_at: basisGeaendertAt } : daten;
  return apiSend<Schaden>(`/api/einsaetze/${einsatzId}/schaeden/${schadenId}`, 'PATCH', body);
}

export function uebergebeSchaden(
  einsatzId: number,
  schadenId: number,
  uebergeben_an: string,
): Promise<Schaden> {
  return apiSend<Schaden>(`/api/einsaetze/${einsatzId}/schaeden/${schadenId}/uebergeben`, 'POST', {
    uebergeben_an,
  });
}

export function schliesseSchadenAb(
  einsatzId: number,
  schadenId: number,
  abschluss_grund: string,
  notiz?: string,
): Promise<Schaden> {
  return apiSend<Schaden>(
    `/api/einsaetze/${einsatzId}/schaeden/${schadenId}/abschliessen`,
    'POST',
    {
      abschluss_grund,
      notiz: notiz ?? null,
    },
  );
}

export function storniereSchaden(einsatzId: number, schadenId: number): Promise<void> {
  return apiSend<void>(`/api/einsaetze/${einsatzId}/schaeden/${schadenId}`, 'DELETE');
}

/** Registriernummer-Anzeige wie im Backend (S-007). */
export function schadenRegistrierAnzeige(nr: number): string {
  return registrierNummer('S', nr);
}

// ---------- Fotos und Dateien ----------

const anhangBasis = (einsatzId: number, schadenId: number) =>
  `/api/einsaetze/${einsatzId}/schaeden/${schadenId}/anhaenge`;

/** Lebende Anhänge eines Schadens, neueste zuerst. */
export function listeSchadenAnhaenge(
  einsatzId: number,
  schadenId: number,
): Promise<SchadenAnhang[]> {
  return apiGet<SchadenAnhang[]>(anhangBasis(einsatzId, schadenId));
}

/**
 * Legt EINE Datei am Schaden ab (Feld `datei`). Mehrere Fotos entstehen über den Serienmodus des
 * Dialogs, jedes mit eigenem ETB-Nachweis. Timeout wie die übrigen Uploads; den Stand der
 * Übertragung meldet `onFortschritt` (LFH-878).
 */
export function legeSchadenAnhangAb(
  einsatzId: number,
  schadenId: number,
  datei: File,
  onFortschritt?: (stand: UploadFortschritt) => void,
): Promise<SchadenAnhang> {
  const fd = new FormData();
  fd.append('datei', datei);
  return apiUploadMitFortschritt<SchadenAnhang>(anhangBasis(einsatzId, schadenId), fd, {
    timeoutMs: UPLOAD_TIMEOUT_MS,
    onFortschritt,
  });
}

/** Entfernt einen Anhang (Soft-Delete mit ETB-Nachweis); `anhangId` ist die Linker-id. */
export function entferneSchadenAnhang(
  einsatzId: number,
  schadenId: number,
  anhangId: number,
): Promise<void> {
  return apiSend<void>(`${anhangBasis(einsatzId, schadenId)}/${anhangId}`, 'DELETE');
}

/**
 * Download über die modul-gegatete Schadensroute, nie über `/anhaenge/{aid}` des Einsatzes (dort
 * 404, die Datei ist modulgebunden). Ein API-Pfad, keine Navigation, deshalb nicht in
 * `routing/deeplinks.ts`.
 */
export function schadenAnhangDownloadPfad(
  einsatzId: number,
  schadenId: number,
  anhangId: number,
): string {
  return `${anhangBasis(einsatzId, schadenId)}/${anhangId}/datei`;
}
