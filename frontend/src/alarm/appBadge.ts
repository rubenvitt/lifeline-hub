import { huelleAppBadge } from '../huelle/faehigkeiten';

/**
 * App-Badge (LLH-1062, Spec `benachrichtigungen`, „Ungelesene Eingänge im Tab-Titel“): die
 * Zahl der unbearbeiteten Meldungen am Symbol der installierten App, wo der Browser die Badging
 * API kennt (`navigator.setAppBadge`). In der Desktop-App setzt die Hülle die Zahl (LLH-1423,
 * `set_app_badge`), statt der Badging API. Sonst nichts: die Zahl steht ohnehin im Tab-Titel.
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
    const huelle = huelleAppBadge();
    if (huelle) void huelle(Math.max(0, zahl)).catch(() => undefined);
    else if (zahl > 0) void nav?.setAppBadge?.(zahl)?.catch(() => undefined);
    else void nav?.clearAppBadge?.()?.catch(() => undefined);
  } catch {
    // Ohne Badging API, ohne Erlaubnis oder ohne Command der Hülle: still.
  }
}
