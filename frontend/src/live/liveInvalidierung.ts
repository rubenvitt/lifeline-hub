import { hashKey, type QueryClient, type QueryKey } from '@tanstack/react-query';

/**
 * Sammelfenster der Live-Invalidierung (LFH-922, design.md D1): fest ab dem ersten Vormerken,
 * nicht nachlaufend, damit ein Dauerstrom (Sammelerfassung) die Anzeige höchstens so lange
 * aufhält.
 */
export const LIVE_SAMMELFENSTER_MS = 300;

/**
 * Eigenes Sammelfenster der Modulzähler (LFH-935, Spec `modul-zaehler`): der Zähler hängt an
 * zwölf Live-Ereignissen und wird in jedem Einsatz-Tab gehalten. Ein Burst kostet so je Tab
 * einen Zählerabruf; die Zahl folgt der Liste höchstens 1 s später.
 */
export const ZAEHLER_SAMMELFENSTER_MS = 1000;

export interface LiveSammler {
  /** Merkt einen Query-Key für den Abgleich am Ende des laufenden Fensters vor. */
  vormerken(queryKey: QueryKey): void;
  /**
   * Effekt-Cleanup: beendet das Fenster und markiert Vorgemerktes nur als veraltet, ohne
   * abzurufen. Wer binnen `staleTime` zurückkehrt, sieht so keinen alten Stand als frisch.
   */
  raeumen(): void;
}

/**
 * Gebündelte Invalidierung für EINE Live-Verbindung (LFH-922), Fenster `fensterMs` (Vorgabe
 * `LIVE_SAMMELFENSTER_MS`; die Modulzähler laufen über einen zweiten Sammler mit
 * `ZAEHLER_SAMMELFENSTER_MS`, LFH-935). Live-Ereignisse invalidieren nur
 * hierüber (`frontend/AGENTS.md`, „Query-Key-Registry“); Seiteneffekte wie Ton und Toast laufen
 * daneben sofort.
 *
 * - Je Key genau ein `invalidateQueries` je Fenster, gleiche Keys über `hashKey` erkannt.
 * - `cancelRefetch: false`: ein laufender Abruf bleibt stehen, statt abgebrochen und neu
 *   gestartet zu werden (der abgebrochene GET liefe sonst auf Leitung und Server zu Ende).
 * - Läuft für einen Key am Ende des Fensters schon ein Abruf, wandert er ins nächste Fenster:
 *   der laufende Abruf kann vor der gemeldeten Änderung gelesen haben, und sein Erfolg nähme die
 *   Markierung wieder weg. So folgt ihm genau ein Abruf, abgebrochen wird nichts.
 * - Ein verdeckter Tab markiert nur (`refetchType: 'none'`); beim Zurückwechseln holt der
 *   `focusManager` jede veraltete aktive Abfrage einmal nach. Gelesen wird am Ende des Fensters.
 */
export function erzeugeLiveSammler(
  qc: QueryClient,
  fensterMs: number = LIVE_SAMMELFENSTER_MS,
): LiveSammler {
  const vorgemerkt = new Map<string, QueryKey>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const markieren = (queryKey: QueryKey, refetchType: 'active' | 'none') =>
    void qc.invalidateQueries({ queryKey, refetchType }, { cancelRefetch: false });

  const abgleichen = () => {
    timer = null;
    const refetchType = document.visibilityState === 'hidden' ? 'none' : 'active';
    const faellig = [...vorgemerkt];
    vorgemerkt.clear();
    for (const [hash, queryKey] of faellig) {
      if (qc.isFetching({ queryKey }) > 0) vorgemerkt.set(hash, queryKey);
      else markieren(queryKey, refetchType);
    }
    if (vorgemerkt.size > 0) timer = setTimeout(abgleichen, fensterMs);
  };

  return {
    vormerken(queryKey) {
      vorgemerkt.set(hashKey(queryKey), queryKey);
      timer ??= setTimeout(abgleichen, fensterMs);
    },
    raeumen() {
      if (timer) clearTimeout(timer);
      timer = null;
      const offen = [...vorgemerkt.values()];
      vorgemerkt.clear();
      offen.forEach((queryKey) => markieren(queryKey, 'none'));
    },
  };
}
