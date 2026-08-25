import type { Personal, PersonalVorschlaege, StaerkePosition } from './types';
import { apiGet, apiSend } from './client';

/** Deutsche Labels der taktischen Stärke-Position (zentral, LFH-4). */
export const POSITION_LABELS: Record<StaerkePosition, string> = {
  fuehrer: 'Führer',
  unterfuehrer: 'Unterführer',
  mannschaft: 'Mannschaft',
};

/** Aus POSITION_LABELS abgeleitete Optionen für Position-Selects. */
export const POSITION_OPTIONEN = (Object.keys(POSITION_LABELS) as StaerkePosition[]).map((p) => ({
  value: p,
  label: POSITION_LABELS[p],
}));

/** Die VOLLE Menge editierbarer Stammfelder — was `PersonalDetailPage` zeigt und schickt. */
export interface PersonalEingabe {
  name: string;
  benutzer_id: number | null;
  personalnummer: string | null;
  traegerorganisation: string | null;
  telefon: string | null;
  staerke_position: StaerkePosition | null;
  bemerkung: string | null;
  qualifikation_ids: number[];
}

export function listePersonal(nurImDienst = false): Promise<Personal[]> {
  const qs = nurImDienst ? '?nur_im_dienst=true' : '';
  return apiGet<Personal[]>(`/api/personal${qs}`);
}

export function ladePersonalVorschlaege(): Promise<PersonalVorschlaege> {
  return apiGet<PersonalVorschlaege>('/api/personal-vorschlaege');
}

/** Anlegen: nur `name` ist Pflicht (`PersonalBody`, alles Weitere `Option<T>`). */
export type PersonalNeu = { name: string } & Partial<Omit<PersonalEingabe, 'name'>>;

/**
 * PATCH ist ein ECHTER Teil-Patch (LFH-306) — Begruendung wortgleich bei `FahrzeugPatch`:
 * die auf vier Felder gekuerzte Schnellerfassung darf die vier NICHT gezeigten (Telefon,
 * Staerke-Position, Benutzer-Konto, Bemerkung) nicht als `null` mitschicken.
 *
 * `qualifikation_ids` ist dabei der gefaehrlichste Key: `Some([])` LEERT die Zuordnung
 * vollstaendig (`src/routes/personal.rs:86`), absent laesst sie stehen.
 */
export type PersonalPatch = Partial<PersonalEingabe>;

export function legePersonAn(daten: PersonalNeu): Promise<Personal> {
  return apiSend<Personal>('/api/personal', 'POST', daten);
}

export function aktualisierePerson(id: number, daten: PersonalPatch): Promise<Personal> {
  return apiSend<Personal>(`/api/personal/${id}`, 'PATCH', daten);
}

export function setzeDienststatus(id: number, inDienst: boolean): Promise<Personal> {
  const pfad = inDienst ? 'in-dienst' : 'ausser-dienst';
  return apiSend<Personal>(`/api/personal/${id}/${pfad}`, 'POST');
}
