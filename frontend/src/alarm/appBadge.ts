/**
 * App-Badge (LLH-1062, Spec `benachrichtigungen`, „Unbearbeitete Meldungen im Tab-Titel“): die
 * Zahl der unbearbeiteten Meldungen am Symbol der installierten App, wo der Browser die Badging
 * API kennt (`navigator.setAppBadge`). Sonst nichts: die Zahl steht ohnehin im Tab-Titel.
 * Wirft nie.
 */
type MitBadge = Navigator & {
  setAppBadge?: (zahl?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

/** Setzt das Badge auf `zahl`; 0 nimmt es weg. */
export function setzeAppBadge(zahl: number): void {
  const nav = (typeof navigator === 'undefined' ? undefined : navigator) as MitBadge | undefined;
  try {
    if (zahl > 0) void nav?.setAppBadge?.(zahl)?.catch(() => undefined);
    else void nav?.clearAppBadge?.()?.catch(() => undefined);
  } catch {
    // Ohne Badging API oder ohne Erlaubnis: still.
  }
}
