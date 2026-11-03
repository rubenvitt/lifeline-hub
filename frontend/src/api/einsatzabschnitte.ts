import type { AbschnittLagezustand, Einsatzabschnitt, NeueVerbindung } from './types';
import { apiGet, apiSend } from './client';

export interface AbschnittEingabe {
  name: string;
  ueber_abschnitt_id?: number | null;
  leiter_id?: number | null;
  bemerkung?: string | null;
  /** LLH-1134: Funkrufname der Abschnittsleitung (Freitext, `null` leert). */
  rufname?: string | null;
  /**
   * LLH-1134: Telefon und weitere Verbindungen; ersetzt die Liste vollständig (`[]` leert).
   * `kommunikationsmittel`/`erreichbarkeit` lehnt der Server mit 400 ab.
   */
  verbindungen?: NeueVerbindung[];
  sortier?: number;
  /**
   * LFH-109: IDs der zuzuordnenden Sprechgruppen aus dem Katalog, nur beim Anlegen; ein bestehender
   * Abschnitt ändert sie einzeln (`AbschnittPatch`, LLH-1456 D4).
   */
  sprechgruppe_ids?: number[];
  /** LFH-608: Rufname im Einsatz („EA-N"), je Einsatz eindeutig (409 sonst). */
  kurzbezeichnung?: string | null;
  /** LFH-608: `null` = nicht beurteilt; ein Wechsel schreibt einen ETB-Eintrag. */
  lagezustand?: AbschnittLagezustand | null;
  /** LFH-608: fester Abschnittsauftrag (Freitext). */
  abschnittsauftrag?: string | null;
}

export function listeAbschnitte(einsatzId: number): Promise<Einsatzabschnitt[]> {
  return apiGet<Einsatzabschnitt[]>(`/api/einsaetze/${einsatzId}/abschnitte`);
}

export function legeAbschnittAn(
  einsatzId: number,
  daten: AbschnittEingabe,
): Promise<Einsatzabschnitt> {
  return apiSend<Einsatzabschnitt>(`/api/einsaetze/${einsatzId}/abschnitte`, 'POST', daten);
}

/**
 * Teiländerung eines Abschnitts (LFH-306, Tri-State): nur die übergebenen Schlüssel gehen hinaus,
 * `null` leert. Der einzige Schreibweg für einen bestehenden Abschnitt: die Zeilen des Details
 * (LFH-1208) und die Fernmeldeskizze (LFH-893) schicken je ein Feld — ein mitgeschickter Stand
 * vom Öffnen überschriebe, was ein anderer Arbeitsplatz inzwischen geändert hat. Ohne
 * `sprechgruppe_ids`: die Sprechgruppen gehen einzeln über `ordneAbschnittSprechgruppeZu`/
 * `loeseAbschnittSprechgruppe` (LLH-1456, D4). Der Server nimmt das Feld weiter an (Wire-Grenze).
 */
export type AbschnittPatch = Partial<Omit<AbschnittEingabe, 'sprechgruppe_ids'>>;

export function patcheAbschnitt(
  einsatzId: number,
  aid: number,
  patch: AbschnittPatch,
): Promise<Einsatzabschnitt> {
  return apiSend<Einsatzabschnitt>(`/api/einsaetze/${einsatzId}/abschnitte/${aid}`, 'PATCH', patch);
}

/**
 * Eine Sprechgruppe dem Abschnitt zuordnen (LLH-1456, D4): idempotent, `204` ohne Körper; eine
 * wirksame Zuordnung schreibt der Server ins Tagebuch.
 */
export function ordneAbschnittSprechgruppeZu(
  einsatzId: number,
  aid: number,
  sprechgruppeId: number,
): Promise<void> {
  return apiSend<void>(
    `/api/einsaetze/${einsatzId}/abschnitte/${aid}/sprechgruppen/${sprechgruppeId}`,
    'PUT',
  );
}

/** Eine Sprechgruppe vom Abschnitt lösen (LLH-1456, D4): idempotent, `204` ohne Körper. */
export function loeseAbschnittSprechgruppe(
  einsatzId: number,
  aid: number,
  sprechgruppeId: number,
): Promise<void> {
  return apiSend<void>(
    `/api/einsaetze/${einsatzId}/abschnitte/${aid}/sprechgruppen/${sprechgruppeId}`,
    'DELETE',
  );
}

export function loeseAbschnittAuf(einsatzId: number, aid: number): Promise<void> {
  return apiSend<void>(`/api/einsaetze/${einsatzId}/abschnitte/${aid}`, 'DELETE');
}

/** L‑2: Fläche (GeoJSON-String) und Verortungs-Metadaten eines Abschnitts.
 *  `null` löscht explizit, undefined = unverändert. */
interface FlaechePatch {
  flaeche_geojson?: string | null;
  tz_fachaufgabe?: string | null;
  tz_organisation?: string | null;
}

/** L‑2: Zeichnet/aktualisiert die taktische Fläche eines Abschnitts. */
export function zeichneAbschnitt(
  einsatzId: number,
  aid: number,
  daten: FlaechePatch,
): Promise<Einsatzabschnitt> {
  return apiSend<Einsatzabschnitt>(
    `/api/einsaetze/${einsatzId}/abschnitte/${aid}/flaeche`,
    'PATCH',
    daten,
  );
}
