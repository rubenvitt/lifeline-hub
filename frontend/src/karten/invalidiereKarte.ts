import type { QueryClient } from '@tanstack/react-query';

/**
 * Einziger Sync-Punkt nach jeder Quellen-Mutation: invalidiert sowohl die
 * Admin-Liste (`['admin-karte']`) als auch die Lauf­zeit-Basemap-Config
 * (`['karte-config']`, von der LagekartePage bezogen). Beide MÜSSEN zusammen
 * invalidiert werden — sonst zeigt der Basemap-Switcher veraltete Quellen.
 */
export function invalidiereKarte(qc: QueryClient): void {
  qc.invalidateQueries({ queryKey: ['admin-karte'] });
  qc.invalidateQueries({ queryKey: ['karte-config'] });
}
