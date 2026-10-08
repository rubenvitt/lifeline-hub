import { beforeEach, vi } from 'vitest';
import { merkeServerzeit, serveruhrVergessenFuerTests } from '../offline/serveruhr';

/** Vorlauf der Geräteuhr in den Tests von LFH-1031. */
export const VORLAUF_MS = 5 * 60_000;

/**
 * Lässt die Geräteuhr für den umgebenden `describe` um `vorlaufMs` vorgehen: `Date` steht auf
 * Serverzeit plus Vorlauf, der Versatz ist aus einem `Date`-Header gemessen, wie ihn jede eigene
 * API-Antwort liefert (`offline/serveruhr.ts`). Nur `Date` ist gefälscht, damit `userEvent`, MSW
 * und antds Animationen auf echten Timern laufen.
 */
export function mitVorgehenderGeraeteuhr(serverMs: number, vorlaufMs = VORLAUF_MS): void {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(serverMs + vorlaufMs);
    serveruhrVergessenFuerTests();
    merkeServerzeit(new Response(null, { headers: { Date: new Date(serverMs).toUTCString() } }));
    return () => {
      vi.useRealTimers();
      serveruhrVergessenFuerTests();
    };
  });
}
