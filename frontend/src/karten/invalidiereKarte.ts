import type { QueryClient } from '@tanstack/react-query';
import { globalKeys } from '../api/queryKeys';

/**
 * Einziger Sync-Punkt nach jeder Quellen-Mutation: invalidiert die Admin-Liste
 * (`globalKeys.adminKarte()`) UND die Laufzeit-Basemap-Config (`globalKeys.karteConfig()`) —
 * sonst zeigt der Basemap-Switcher veraltete Quellen.
 */
export function invalidiereKarte(qc: QueryClient): void {
  qc.invalidateQueries({ queryKey: globalKeys.adminKarte() });
  qc.invalidateQueries({ queryKey: globalKeys.karteConfig() });
}
