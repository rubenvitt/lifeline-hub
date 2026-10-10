import type { AdminAktion, AnmeldeEintrag, AnmeldeEreignis, Zugangsaenderung } from './types';
import { apiGet, mitParametern } from './client';

/**
 * Zugangsprotokoll der Verwaltung (LFH-1097): Anmeldespur und Admin-Spur, nur für den
 * System-Admin (sonst 403). Das Lesen selbst schreibt keine Spur. Beide Routen liefern die
 * neueste Zeile zuerst und blättern über `vor_id` (kleinste `id` der letzten Seite).
 */

const BASIS = '/api/zugangsprotokoll';

/** Seitengröße; gleich der Vorgabe des Servers (`auth::spur::STANDARD_LIMIT`). */
export const ZUGANGSPROTOKOLL_SEITE = 100;

/** Filter beider Spuren. Zeiten im Wire-Format (UTC ohne Zone), leere Werte fehlen. */
export interface SpurFilter {
  von?: string;
  bis?: string;
  konto?: string;
}

export interface AnmeldeFilter extends SpurFilter {
  ereignis?: AnmeldeEreignis;
}

export interface AenderungsFilter extends SpurFilter {
  aktion?: AdminAktion;
}

/** `GET /api/zugangsprotokoll/anmeldungen` — eine Seite der Anmeldespur. */
export function ladeAnmeldungen(
  filter: AnmeldeFilter,
  vorId: number | undefined,
): Promise<AnmeldeEintrag[]> {
  return apiGet<AnmeldeEintrag[]>(
    mitParametern(`${BASIS}/anmeldungen`, {
      ...filter,
      vor_id: vorId,
      limit: ZUGANGSPROTOKOLL_SEITE,
    }),
  );
}

/** `GET /api/zugangsprotokoll/zugangsaenderungen` — eine Seite der Admin-Spur. */
export function ladeZugangsaenderungen(
  filter: AenderungsFilter,
  vorId: number | undefined,
): Promise<Zugangsaenderung[]> {
  return apiGet<Zugangsaenderung[]>(
    mitParametern(`${BASIS}/zugangsaenderungen`, {
      ...filter,
      vor_id: vorId,
      limit: ZUGANGSPROTOKOLL_SEITE,
    }),
  );
}

/** Cursor der nächsten Seite: kleinste `id` der letzten, `undefined` am Ende. */
export function naechsteVorId(letzte: readonly { id: number }[]): number | undefined {
  return letzte.length < ZUGANGSPROTOKOLL_SEITE ? undefined : letzte[letzte.length - 1].id;
}
