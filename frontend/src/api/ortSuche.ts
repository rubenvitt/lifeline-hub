// Ortssuche des Ortsfelds (LFH-1175, Spec `ortsfeld`): dieselbe Antwort wie die Adresssuche der
// Lagekarte, aber an Routen ohne Lagekarten-Gate.
import { apiGet, mitParametern } from './client';
import type { OrtSucheAntwort } from './karteOrtSuche';

/** GET /api/einsaetze/:id/ort-suche — Recht der Einsatzdaten, bevorzugt die Umgebung des Einsatzorts. */
export function sucheOrtImEinsatz(einsatzId: number, begriff: string): Promise<OrtSucheAntwort> {
  return apiGet<OrtSucheAntwort>(
    mitParametern(`/api/einsaetze/${einsatzId}/ort-suche`, { q: begriff }),
  );
}

/** GET /api/ort-suche — ohne Einsatz, für „Einsatz anlegen“ (wer Einsätze anlegen darf). */
export function sucheOrtInOrg(begriff: string): Promise<OrtSucheAntwort> {
  return apiGet<OrtSucheAntwort>(mitParametern('/api/ort-suche', { q: begriff }));
}
