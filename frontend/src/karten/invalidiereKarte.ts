import type { QueryClient } from '@tanstack/react-query';
import { globalKeys } from '../api/queryKeys';

/**
 * Einziger Sync-Punkt nach jeder Quellen-Mutation: invalidiert sowohl die
 * Admin-Liste (`globalKeys.adminKarte()`) als auch die Lauf­zeit-Basemap-Config
 * (`globalKeys.karteConfig()`, von der LagekartePage bezogen). Beide MÜSSEN zusammen
 * invalidiert werden — sonst zeigt der Basemap-Switcher veraltete Quellen.
 */
export function invalidiereKarte(qc: QueryClient): void {
  qc.invalidateQueries({ queryKey: globalKeys.adminKarte() });
  qc.invalidateQueries({ queryKey: globalKeys.karteConfig() });
}
