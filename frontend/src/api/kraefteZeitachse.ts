import { apiGet, apiSend } from './client';
import type {
  EinheitPerioden,
  PersonPerioden,
  Zeitachse,
  ZeitachseNachtragBody,
  ZeitachsePeriodeBody,
} from './types';

/**
 * Kräfte-Zeitachse (LFH-552): Perioden je Einheit/Person, Zeitachse einer Kraft, Nachtrag,
 * Streichung, Berichtigung des Zeitpunkts (LLH-1455) und ganze Periode (LLH-1538). Die Pfade liegen unter den Modulen Einheiten bzw. Personal und erben deren Sperre.
 */
export type KraftArt = 'einheit' | 'person';

function kraftPfad(einsatzId: number, art: KraftArt, id: number): string {
  const modul = art === 'einheit' ? 'einheiten' : 'personal';
  return `/api/einsaetze/${einsatzId}/${modul}/${id}/zeitachse`;
}

/** Perioden je Einheit (nur Einheiten mit Ereignissen) — Spalte „Im Einsatz" im Meldebild. */
export function listeEinheitenPerioden(einsatzId: number): Promise<EinheitPerioden[]> {
  return apiGet<EinheitPerioden[]>(`/api/einsaetze/${einsatzId}/einheiten/zeitachse`);
}

/** Perioden je Person (nur Personen mit Ereignissen) — Personal-Seite. */
export function listePersonalPerioden(einsatzId: number): Promise<PersonPerioden[]> {
  return apiGet<PersonPerioden[]>(`/api/einsaetze/${einsatzId}/personal/zeitachse`);
}

export function ladeZeitachse(einsatzId: number, art: KraftArt, id: number): Promise<Zeitachse> {
  return apiGet<Zeitachse>(kraftPfad(einsatzId, art, id));
}

/** Nachtrag von Hand; an einer Einheit mit Fan-out auf ihre Personen. */
export function trageNach(
  einsatzId: number,
  art: KraftArt,
  id: number,
  body: ZeitachseNachtragBody,
): Promise<Zeitachse> {
  return apiSend<Zeitachse>(kraftPfad(einsatzId, art, id), 'POST', body);
}

/**
 * Trägt eine abgeschlossene Periode in einem Schritt nach (LLH-1538): Alarmierung und/oder
 * Eintreffen und die Entlassung; geprüft wird nur das Ergebnis. An einer Einheit mit Fan-out.
 */
export function tragePeriodeNach(
  einsatzId: number,
  art: KraftArt,
  id: number,
  body: ZeitachsePeriodeBody,
): Promise<Zeitachse> {
  return apiSend<Zeitachse>(`${kraftPfad(einsatzId, art, id)}/periode`, 'POST', body);
}

/** Streicht ein Ereignis (unumkehrbar, Grund Pflicht); der alte Stand bleibt lesbar. */
export function streicheEreignis(
  einsatzId: number,
  art: KraftArt,
  id: number,
  ereignisId: number,
  grund: string,
): Promise<Zeitachse> {
  return apiSend<Zeitachse>(`${kraftPfad(einsatzId, art, id)}/${ereignisId}/streichen`, 'POST', {
    grund,
  });
}

/**
 * Berichtigt den Zeitpunkt eines Ereignisses in einem Schritt (LLH-1455): der Server streicht es mit
 * dem Grund und schreibt es zum neuen Zeitpunkt neu; geprüft wird nur das Ergebnis.
 */
export function berichtigeEreignis(
  einsatzId: number,
  art: KraftArt,
  id: number,
  ereignisId: number,
  body: { zeitpunkt_at: string; grund: string },
): Promise<Zeitachse> {
  return apiSend<Zeitachse>(
    `${kraftPfad(einsatzId, art, id)}/${ereignisId}/berichtigen`,
    'POST',
    body,
  );
}
