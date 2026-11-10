import { http, HttpResponse } from 'msw';
import type { StammdatenArt } from '../api/types';

/**
 * Herkunfts-Handler für Tests mit Stammdaten vom Hub (LLH-1493, kjezbk06 D6): die Org hat eine
 * Quelle, und die genannten Schlüssel je Art kommen vom Hub. Alles andere ist „nur hier“. Per
 * `server.use(…)` über den Standard aus `test/server.ts` (ohne Quelle) legen.
 */
export function herkunftHandler(vomHub: Partial<Record<StammdatenArt, string[]>>) {
  return http.get('/api/instanz/stammdaten/herkunft', () =>
    HttpResponse.json({
      quelle: 'Hub DRK Landesverband',
      vom_hub: vomHub,
      admins_ohne_passkey: [],
    }),
  );
}
