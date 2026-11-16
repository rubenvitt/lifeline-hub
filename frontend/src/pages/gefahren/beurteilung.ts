import type { Gefahrengebiet } from '../../api/types';

/**
 * Beurteilung der Gefahrenmatrix je Gefahrengebiet (LLH-1090, Spec `gefahrenmatrix`): EINE Stelle
 * für den Wortlaut auf der Gefahrenseite, in der Palettenvorschau, im Lagebild und im Überblick.
 * Eine Zelle ohne Bewertung zeigt „keine“; ob jemand die Matrix angesehen hat, sagt nur das Gebiet.
 */
export const UNBESTAETIGT = 'unbestätigt';
/**
 * Gegenstück zu {@link UNBESTAETIGT} (LLH-1745): „bestätigt“, passend zum Knopf „Beurteilung
 * bestätigen“. Früher „nicht beurteilt“/„beurteilt“ — das las sich neben „hoch“ als „die Stufe ist
 * nicht bewertet“; gemeint ist „die Bewertung ist nicht bestätigt“.
 */
export const BESTAETIGT = 'bestätigt';

type MitBeurteilung = Pick<Gefahrengebiet, 'beurteilt_at' | 'beurteilt_von_name'>;

export function istBeurteilt(g: MitBeurteilung): boolean {
  return g.beurteilt_at != null;
}

/**
 * „bestätigt 201512okt26 · Name“ oder „unbestätigt“. Die Zeit formatiert der Aufrufer in der
 * Anzeigezone (`useAnzeigeKonventionen().zeitpunkt`); ohne Namen (Konto entfernt) nur die Zeit.
 */
export function beurteilungText(g: MitBeurteilung, zeitpunkt: (utc: string) => string): string {
  if (!g.beurteilt_at) return UNBESTAETIGT;
  const zeit = `${BESTAETIGT} ${zeitpunkt(g.beurteilt_at)}`;
  return g.beurteilt_von_name ? `${zeit} · ${g.beurteilt_von_name}` : zeit;
}
