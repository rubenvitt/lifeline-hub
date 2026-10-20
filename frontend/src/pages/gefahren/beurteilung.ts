import type { Gefahrengebiet } from '../../api/types';

/**
 * Beurteilung der Gefahrenmatrix je Gefahrengebiet (LLH-1090, Spec `gefahrenmatrix`): EINE Stelle
 * für den Wortlaut auf der Gefahrenseite, in der Palettenvorschau, im Lagebild und im Überblick.
 * Eine Zelle ohne Bewertung zeigt „keine“; ob jemand die Matrix angesehen hat, sagt nur das Gebiet.
 */
export const NICHT_BEURTEILT = 'nicht beurteilt';

type MitBeurteilung = Pick<Gefahrengebiet, 'beurteilt_at' | 'beurteilt_von_name'>;

export function istBeurteilt(g: MitBeurteilung): boolean {
  return g.beurteilt_at != null;
}

/**
 * „beurteilt 201512OKT2026 · Name“ oder „nicht beurteilt“. Die Zeit formatiert der Aufrufer in der
 * Anzeigezone (`useAnzeigeKonventionen().formatZeit`); ohne Namen (Konto entfernt) nur die Zeit.
 */
export function beurteilungText(g: MitBeurteilung, formatZeit: (utc: string) => string): string {
  if (!g.beurteilt_at) return NICHT_BEURTEILT;
  const zeit = `beurteilt ${formatZeit(g.beurteilt_at)}`;
  return g.beurteilt_von_name ? `${zeit} · ${g.beurteilt_von_name}` : zeit;
}
