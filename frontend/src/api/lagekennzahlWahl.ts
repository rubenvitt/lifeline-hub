import { apiSend } from './client';
import type { Lagekennzahl, LagekennzahlWahl } from './types';

/**
 * Wahl der Lagekennzahlen eines Einsatzes (LLH-1371): `PUT …/lagekennzahl-wahl` ersetzt die
 * gewählten vollständig. Gelesen wird die Wahl aus `EinsatzAnzeige.lagekennzahlen` — nach dem
 * Speichern also den Einsatz-Key invalidieren.
 */
export function setzeLagekennzahlWahl(
  einsatzId: number,
  gewaehlt: Lagekennzahl[],
): Promise<LagekennzahlWahl> {
  return apiSend<LagekennzahlWahl>(`/api/einsaetze/${einsatzId}/lagekennzahl-wahl`, 'PUT', {
    gewaehlt,
  });
}
