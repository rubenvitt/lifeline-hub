import { hashKey, type QueryClient, type QueryKey } from '@tanstack/react-query';

/**
 * Sammelfenster der Live-Invalidierung (LFH-922, design.md D1): fest ab dem ersten Vormerken,
 * nicht nachlaufend, damit ein Dauerstrom (Sammelerfassung) die Anzeige höchstens so lange
 * aufhält.
 */
export const LIVE_SAMMELFENSTER_MS = 300;

export interface LiveSammler {
  /** Merkt einen Query-Key für den Abgleich am Ende des laufenden Fensters vor. */
  vormerken(queryKey: QueryKey): void;
  /** Verwirft Vorgemerktes und Timer, ohne zu invalidieren (Effekt-Cleanup). */
  raeumen(): void;
}

/**
 * Gebündelte Invalidierung für EINE Live-Verbindung (LFH-922). Live-Ereignisse invalidieren nur
 * hierüber (`frontend/AGENTS.md`, „Query-Key-Registry“); Seiteneffekte wie Ton und Toast laufen
 * daneben sofort.
 *
 * - Je Key genau ein `invalidateQueries` je Fenster, gleiche Keys über `hashKey` erkannt.
 * - `cancelRefetch: false`: ein laufender Abruf bleibt stehen, statt abgebrochen und neu
 *   gestartet zu werden (der abgebrochene GET liefe sonst auf Leitung und Server zu Ende).
 * - Ein verdeckter Tab markiert nur (`refetchType: 'none'`); beim Zurückwechseln holt der
 *   `focusManager` jede veraltete aktive Abfrage einmal nach. Gelesen wird am Ende des Fensters.
 */
export function erzeugeLiveSammler(qc: QueryClient): LiveSammler {
  const vorgemerkt = new Map<string, QueryKey>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const abgleichen = () => {
    timer = null;
    const refetchType = document.visibilityState === 'hidden' ? 'none' : 'active';
    const keys = [...vorgemerkt.values()];
    vorgemerkt.clear();
    keys.forEach(
      (queryKey) => void qc.invalidateQueries({ queryKey, refetchType }, { cancelRefetch: false }),
    );
  };

  return {
    vormerken(queryKey) {
      vorgemerkt.set(hashKey(queryKey), queryKey);
      timer ??= setTimeout(abgleichen, LIVE_SAMMELFENSTER_MS);
    },
    raeumen() {
      if (timer) clearTimeout(timer);
      timer = null;
      vorgemerkt.clear();
    },
  };
}
