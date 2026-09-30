import { ApiError } from './client';

/**
 * Abrufzustand einer Liste, die eine Seite neben ihrer eigenen lädt. `gesperrt` ist 403: die
 * Modulfreigabe der Person deckt die Quelle nicht (ein Modul-Gate deckt den eigenen Pfad, nicht
 * die Nachbarn). Das ist kein Defekt, und es ist erst recht kein leerer Bestand; wer daraus eine
 * „0" macht, meldet eine Lage, die niemand geprüft hat.
 *
 * Geteilt von Meldebild und Funkplan (LFH-548), damit beide dieselbe Weiche fahren.
 */
export type AbrufZustand = 'daten' | 'laden' | 'fehler' | 'gesperrt';

export function abrufZustand(q: {
  error: unknown;
  isError: boolean;
  isPending: boolean;
}): AbrufZustand {
  if (q.error instanceof ApiError && q.error.status === 403) return 'gesperrt';
  if (q.isError) return 'fehler';
  // `isPending`, nicht `isLoading`: in TanStack v5 ist `isLoading = isPending && isFetching`. Eine
  // pausierte Abfrage (offline, nie geladen) hätte sonst „Daten“, nämlich keine, und jede Zählung
  // daraus behauptete „0“ (LFH-548, Review).
  if (q.isPending) return 'laden';
  return 'daten';
}

const RANG: Record<AbrufZustand, number> = { daten: 0, laden: 1, fehler: 2, gesperrt: 3 };

/**
 * Der Zustand einer Aussage, die aus mehreren Quellen gerechnet wird: der schlechteste. Gesperrt
 * vor Fehler, weil der Grund „nicht freigegeben" auch nach einem erneuten Laden gilt.
 */
export function schlechtesterZustand(...zustaende: AbrufZustand[]): AbrufZustand {
  return zustaende.reduce<AbrufZustand>((a, b) => (RANG[b] > RANG[a] ? b : a), 'daten');
}
