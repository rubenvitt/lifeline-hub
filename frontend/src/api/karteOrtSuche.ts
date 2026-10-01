// Response-Typen sind Re-Exporte der aus Rust generierten Schemas.
import { apiGet, mitParametern } from './client';
import type { components } from './types.generated';

type S = components['schemas'];

/** Antwort von GET /api/einsaetze/:id/karte/ort-suche. Rust: `OrtSucheAntwort` (LFH-638).
 *  Ein Geocoder-Ausfall kommt als `zustand`, nie als Fehlerstatus; `ok` ohne Treffer heißt
 *  „nichts gefunden“. */
export type OrtSucheAntwort = S['OrtSucheAntwort'];
export type OrtSucheZustand = S['OrtSucheZustand'];
export type OrtTreffer = S['OrtTreffer'];

/** Sucht eine Adresse über den Geocoder der Organisation (Modul Lagekarte). */
export function sucheOrt(einsatzId: number, begriff: string): Promise<OrtSucheAntwort> {
  return apiGet<OrtSucheAntwort>(
    mitParametern(`/api/einsaetze/${einsatzId}/karte/ort-suche`, { q: begriff }),
  );
}
