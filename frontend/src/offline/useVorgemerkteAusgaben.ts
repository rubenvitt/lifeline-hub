import {
  useVorgemerkteSchreibaktionen,
  type VorgemerkteSchreibaktion,
} from './useVorgemerkteSchreibaktionen';

/** Eine auf diesem Gerät vorgemerkte, vom Server noch nicht bestätigte Verpflegungsausgabe. */
export type VorgemerkteAusgabe = VorgemerkteSchreibaktion<'ausgabe'>;

/**
 * Reaktive Sicht auf die vorgemerkten Ausgaben eines Einsatzes (LFH-688, design.md D8), über
 * `useVorgemerkteSchreibaktionen`: abgelehnte gehören in den Wiederherstellungs-Drawer, nicht als
 * „ausstehend“ an die Karte; ein Flush in einem anderen Tab räumt „ausstehend“ auch hier.
 */
export function useVorgemerkteAusgaben(
  benutzerId: number | undefined,
  einsatzId: number,
): VorgemerkteAusgabe[] {
  return useVorgemerkteSchreibaktionen(benutzerId, einsatzId, 'ausgabe');
}
