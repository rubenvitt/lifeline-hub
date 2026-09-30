import { apiGet, apiSend } from './client';
import type {
  Medienkontakt,
  MedienkontaktArt,
  MedienkontaktStatus,
  Pressemitteilung,
  PressemitteilungAbschnitt,
  PressemitteilungVorlageKey,
} from './types';

/**
 * Presse- und Medienarbeit S5 (LFH-554): Presse-Log und Pressemitteilungen unter dem Stab.
 * Die Routen erben die Sperre des Stab-Moduls; freigeben darf nur die Einsatzleitung (403
 * sonst). Zeiten am Draht: UTC ohne Zonenkennung, als Eingabe auch ISO mit Zone.
 */
const basis = (einsatzId: number) => `/api/einsaetze/${einsatzId}/stab`;

// ── Presse-Log ──────────────────────────────────────────────────────────────────────────────

/** Offene zuerst, dann jüngster Eingang zuerst (Ordnung vom Server). */
export function ladeMedienkontakte(einsatzId: number): Promise<Medienkontakt[]> {
  return apiGet<Medienkontakt[]>(`${basis(einsatzId)}/medienkontakte`);
}

/** Kein Backend-Schema: Eingabe-Body von `POST …/stab/medienkontakte`. */
export interface MedienkontaktEingabe {
  art: MedienkontaktArt;
  medium: string;
  thema: string;
  kontakt_name?: string;
  kontakt_erreichbarkeit?: string;
  /** Fehlt = jetzt. */
  eingang_at?: string;
}

export function legeMedienkontaktAn(
  einsatzId: number,
  body: MedienkontaktEingabe,
): Promise<Medienkontakt> {
  return apiSend<Medienkontakt>(`${basis(einsatzId)}/medienkontakte`, 'POST', body);
}

/** Kein Backend-Schema: Teiländerung; `null` leert Ansprechperson bzw. Erreichbarkeit. */
export interface MedienkontaktPatch {
  medium?: string;
  thema?: string;
  kontakt_name?: string | null;
  kontakt_erreichbarkeit?: string | null;
  eingang_at?: string;
}

export function aendereMedienkontakt(
  einsatzId: number,
  kontaktId: number,
  body: MedienkontaktPatch,
): Promise<Medienkontakt> {
  return apiSend<Medienkontakt>(`${basis(einsatzId)}/medienkontakte/${kontaktId}`, 'PATCH', body);
}

/** Kein Backend-Schema: Statuswechsel. `beantwortet` verlangt `antwort` (sonst 422). */
export interface MedienkontaktStatusEingabe {
  status: MedienkontaktStatus;
  antwort?: string;
  freigabe_durch?: string;
  pressemitteilung_id?: number;
}

export function setzeMedienkontaktStatus(
  einsatzId: number,
  kontaktId: number,
  body: MedienkontaktStatusEingabe,
): Promise<Medienkontakt> {
  return apiSend<Medienkontakt>(
    `${basis(einsatzId)}/medienkontakte/${kontaktId}/status`,
    'POST',
    body,
  );
}

// ── Pressemitteilungen ──────────────────────────────────────────────────────────────────────

export function ladePressemitteilungen(einsatzId: number): Promise<Pressemitteilung[]> {
  return apiGet<Pressemitteilung[]>(`${basis(einsatzId)}/pressemitteilungen`);
}

export function ladePressemitteilung(einsatzId: number, id: number): Promise<Pressemitteilung> {
  return apiGet<Pressemitteilung>(`${basis(einsatzId)}/pressemitteilungen/${id}`);
}

/** Kein Backend-Schema: Anlegen mit optionalem Startinhalt (wie beim Lagebericht). */
export interface NeuePressemitteilung {
  vorlage: PressemitteilungVorlageKey;
  titel: string;
  zeitstand?: string;
  abschnitte?: PressemitteilungAbschnitt[];
}

export function legePressemitteilungAn(
  einsatzId: number,
  daten: NeuePressemitteilung,
): Promise<Pressemitteilung> {
  return apiSend<Pressemitteilung>(`${basis(einsatzId)}/pressemitteilungen`, 'POST', daten);
}

/** Kein Backend-Schema: nur solange Entwurf (sonst 422). */
export interface PressemitteilungPatch {
  titel?: string;
  zeitstand?: string;
  abschnitte?: PressemitteilungAbschnitt[];
}

export function aktualisierePressemitteilung(
  einsatzId: number,
  id: number,
  patch: PressemitteilungPatch,
): Promise<Pressemitteilung> {
  return apiSend<Pressemitteilung>(`${basis(einsatzId)}/pressemitteilungen/${id}`, 'PATCH', patch);
}

/** Nur die Einsatzleitung; schreibt den ETB-Snapshot (Typ `meldung`). */
export function gibPressemitteilungFrei(einsatzId: number, id: number): Promise<Pressemitteilung> {
  return apiSend<Pressemitteilung>(
    `${basis(einsatzId)}/pressemitteilungen/${id}/freigeben`,
    'POST',
  );
}

export function schreibePressemitteilungFort(
  einsatzId: number,
  id: number,
  zeitstand?: string,
): Promise<Pressemitteilung> {
  return apiSend<Pressemitteilung>(
    `${basis(einsatzId)}/pressemitteilungen/${id}/fortschreiben`,
    'POST',
    { zeitstand },
  );
}
