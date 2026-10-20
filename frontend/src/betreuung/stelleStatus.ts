import type { BetreuungsstelleStatus } from '../api/types';

/**
 * Statuswechsel einer Betreuungsstelle als Handlung (LLH-1044): der Knopf nennt, was geschieht,
 * nicht den Zielzustand (LFH-959). Je Status genau ein nächster Schritt; „Wieder öffnen" führt
 * eine geschlossene Stelle zurück in Betrieb. Umkehrbar, deshalb ohne Rückfrage (LFH-363).
 */
export interface StatusHandlung {
  ziel: BetreuungsstelleStatus;
  text: string;
}

export const STATUS_HANDLUNG: Record<BetreuungsstelleStatus, StatusHandlung> = {
  vorbereitet: { ziel: 'in_betrieb', text: 'In Betrieb nehmen' },
  in_betrieb: { ziel: 'geschlossen', text: 'Schließen' },
  geschlossen: { ziel: 'in_betrieb', text: 'Wieder öffnen' },
};

/**
 * Braucht das Schließen vorher eine Leermeldung? Genau dann, wenn die Stelle JETZT belegt ist —
 * der Server lehnt „geschlossen und belegt" mit 422 ab.
 */
export function schliessenBrauchtLeermeldung(
  ziel: BetreuungsstelleStatus,
  belegt: number | undefined,
): boolean {
  return ziel === 'geschlossen' && (belegt ?? 0) > 0;
}
