/**
 * Bildschleife der Suite auf echten Timern (LLH-2023), eingesetzt in `setup.ts`.
 *
 * jsdom 31 startet seine eigene Schleife erst bei Bedarf über Nodes globales `setInterval`.
 * Fälschte ein Test `setInterval`, während ein Bild angefordert wurde (etwa
 * `vi.useFakeTimers({ toFake: ['Date', 'setInterval', …] })`), lief die Schleife auf dem
 * gefälschten Intervall weiter: nach `useRealTimers()` feuerte für den Rest der Datei kein
 * `requestAnimationFrame` mehr, und der späte `autoFocus` jedes Menüs blieb aus (BrDetailPage,
 * zwölf Tests je nach Takt). Diese Schleife nimmt die beim Erzeugen gesicherten Timer; Bilder,
 * die im selben Takt angefordert werden, laufen wie im Browser zusammen.
 *
 * `anhalten` verwirft alle angeforderten Bilder und nimmt keine neuen mehr an — für den Abbau
 * der Datei, nach dem die jsdom-Umgebung fehlt. Wächter: ./bildschleife.test.ts.
 */
export function erzeugeBildschleife() {
  const echtesSetTimeout = globalThis.setTimeout;
  const echtesClearTimeout = globalThis.clearTimeout;
  const jetzt = performance.now.bind(performance);
  const angefordert = new Map<number, FrameRequestCallback>();
  let naechsteKennung = 0;
  let takt: ReturnType<typeof setTimeout> | null = null;
  let angehalten = false;

  const bild = () => {
    takt = null;
    const faellig = [...angefordert.values()];
    angefordert.clear();
    const zeit = jetzt();
    for (const rueckruf of faellig) {
      // Wie im Browser: ein werfender Rückruf hält die übrigen nicht auf, der Fehler bleibt laut.
      try {
        rueckruf(zeit);
      } catch (fehler) {
        queueMicrotask(() => {
          throw fehler;
        });
      }
    }
  };

  const requestAnimationFrame = (rueckruf: FrameRequestCallback): number => {
    naechsteKennung += 1;
    if (angehalten) return naechsteKennung;
    angefordert.set(naechsteKennung, rueckruf);
    takt ??= echtesSetTimeout(bild, 1000 / 60);
    return naechsteKennung;
  };

  const cancelAnimationFrame = (kennung: number): void => {
    angefordert.delete(kennung);
    if (angefordert.size === 0 && takt !== null) {
      echtesClearTimeout(takt);
      takt = null;
    }
  };

  const anhalten = (): void => {
    angehalten = true;
    angefordert.clear();
    if (takt !== null) echtesClearTimeout(takt);
    takt = null;
  };

  return { requestAnimationFrame, cancelAnimationFrame, anhalten };
}
