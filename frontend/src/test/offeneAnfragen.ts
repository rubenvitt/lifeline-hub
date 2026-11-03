/**
 * Eine offene Anfrage bricht nach ihrem Test nicht mehr ab (LLH-1536).
 *
 * Viele Tests halten eine Anfrage absichtlich offen (msw-Handler mit einem Promise, das nie
 * erfüllt wird), um den Zustand „läuft noch“ zu prüfen. Nach dem Test lief sie weiter, bis ihr
 * `AbortSignal.timeout(15_000)` aus `api/client.ts` feuerte, also mitten in einem späteren Test
 * derselben Datei. Der Abbruch zerstört den Socket. In den Millisekunden danach erkennt
 * `@mswjs/interceptors` (0.45.9 bis 0.45.11) neue Undici-Verbindungen nicht sicher als HTTP:
 * Liest der Client, bevor seine Anfrage im Socket liegt, gilt die Verbindung nach einem
 * `setImmediate` als „Server spricht zuerst“ und geht am Mock vorbei ins echte Netz
 * (`ECONNREFUSED 127.0.0.1:3000`). Die Seite zeigte dann „Keine Verbindung — die Aktion wurde
 * NICHT abgeschickt“ oder lud ihre Liste nicht. Nachgestellt in `offeneAnfragen.test.ts`.
 *
 * Deshalb reicht `fetch` Abbrüche (Frist, Unmount, eigenes Signal) nur weiter, solange der Test
 * läuft, der die Anfrage gestellt hat. Danach bleibt eine offene Anfrage offen, bis die Datei
 * endet, und kein später Abbruch trifft einen fremden Test.
 */

let testEnde = new AbortController();

/** Hängt die Abbruch-Grenze an `fetch`. Einmal je Datei, vor dem ersten Test. */
export function installiereAnfragenGrenze(): void {
  const echterFetch = globalThis.fetch;
  if (typeof echterFetch !== 'function') return;
  globalThis.fetch = function fetchMitTestgrenze(
    eingabe: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const quelle = init?.signal ?? (eingabe instanceof Request ? eingabe.signal : undefined);
    if (!quelle) return echterFetch(eingabe, init);
    const innen = new AbortController();
    if (quelle.aborted) innen.abort(quelle.reason);
    else
      quelle.addEventListener('abort', () => innen.abort(quelle.reason), {
        once: true,
        signal: testEnde.signal,
      });
    return echterFetch(eingabe, { ...init, signal: innen.signal });
  };
}

/** Nach jedem Test: spätere Abbrüche erreichen dessen offene Anfragen nicht mehr. */
export function trenneOffeneAnfragen(): void {
  testEnde.abort();
  testEnde = new AbortController();
}
