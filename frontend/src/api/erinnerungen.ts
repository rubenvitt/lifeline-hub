import { apiGet, apiSend, mitParametern } from './client';
import type { AbschlussCursor } from './meldungen';
import type { Erinnerung, ErinnerungKennzahlen, NeueErinnerung } from './types';

/** Seitengröße der abgeschlossenen Erinnerungen (LFH-940). */
export const ERINNERUNGEN_SEITE = 100;

/** Offene Erinnerungen; ohne Parameter liefert der Server nur offene (LFH-940). */
export function listeOffeneErinnerungen(einsatzId: number): Promise<Erinnerung[]> {
  return apiGet<Erinnerung[]>(`/api/incidents/${einsatzId}/reminders`);
}

/** Ordnungszeit wie am Server: `COALESCE(erledigt_at, quittiert_at, erstellt_at)`. */
export function erinnerungCursor(e: Erinnerung): AbschlussCursor {
  return { zeit: e.erledigt_at ?? e.quittiert_at ?? e.erstellt_at, id: e.id };
}

/** Eine Seite abgeschlossener Erinnerungen, zuletzt abgeschlossene zuerst (LFH-940). */
export function listeAbgeschlosseneErinnerungen(
  einsatzId: number,
  vor?: AbschlussCursor,
  limit: number = ERINNERUNGEN_SEITE,
): Promise<Erinnerung[]> {
  return apiGet<Erinnerung[]>(
    mitParametern(`/api/incidents/${einsatzId}/reminders`, {
      phase: 'abgeschlossen',
      vor_zeit: vor?.zeit,
      vor_id: vor?.id,
      limit,
    }),
  );
}

/** Offen und abgeschlossen über den ganzen Bestand (LFH-940). */
export function ladeErinnerungKennzahlen(einsatzId: number): Promise<ErinnerungKennzahlen> {
  return apiGet<ErinnerungKennzahlen>(`/api/incidents/${einsatzId}/reminders/metrics`);
}

export function legeErinnerungAn(einsatzId: number, daten: NeueErinnerung): Promise<Erinnerung> {
  return apiSend<Erinnerung>(`/api/incidents/${einsatzId}/reminders`, 'POST', daten);
}

export function erledigeErinnerung(einsatzId: number, id: number): Promise<Erinnerung> {
  return apiSend<Erinnerung>(`/api/incidents/${einsatzId}/reminders/${id}/complete`, 'POST');
}

export function quittiereErinnerung(einsatzId: number, id: number): Promise<Erinnerung> {
  return apiSend<Erinnerung>(`/api/incidents/${einsatzId}/reminders/${id}/acknowledge`, 'POST');
}

/**
 * Nimmt Erledigt/Quittiert zurück, der Gegenweg zur Direktaktion ohne Rückfrage. Räumt
 * serverseitig alle drei Achsen (Status, Vollzug, Quittung); auf eine offene Erinnerung: 422.
 */
export function oeffneErinnerung(einsatzId: number, id: number): Promise<Erinnerung> {
  return apiSend<Erinnerung>(`/api/incidents/${einsatzId}/reminders/${id}/reopen`, 'POST');
}
