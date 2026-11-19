import { expect } from 'vitest';
import { KACHELGRENZE_SELEKTOR } from '../components/KachelGrenze';

/**
 * WÄCHTER „Jede Kachel einer Lagefläche hat ihre eigene Fehlergrenze“ (LLH-1958,
 * `frontend/AGENTS.md`). Kacheln sind Alarmzeile, Kennzahlenband, Paneel und die Kachel des
 * Lagemonitors. Gezählt werden nur die obersten: Ein Paneel in einem Paneel gehört zu seiner
 * Kachel.
 */
export const KACHEL_SELEKTOR =
  '[data-lfh="alarm-zeile"], [data-lfh="kennzahlenband"], [data-lfh="paneel"], [data-lfh="monitor-kachel"]';

/** Prüft, dass jede oberste Kachel der Fläche in ihrer eigenen `KachelGrenze` steht. */
export function pruefeKachelGrenzen(flaeche: Element, mindestens: number): void {
  const kacheln = Array.from(flaeche.querySelectorAll(KACHEL_SELEKTOR)).filter((k) => {
    const vorfahr = k.parentElement?.closest(KACHEL_SELEKTOR);
    return vorfahr == null || !flaeche.contains(vorfahr);
  });
  expect(kacheln.length, 'Zahl der Kacheln').toBeGreaterThanOrEqual(mindestens);
  const grenzen = new Set<Element>();
  for (const k of kacheln) {
    const grenze = k.closest(KACHELGRENZE_SELEKTOR);
    const name = k.getAttribute('aria-label') ?? k.textContent?.slice(0, 40);
    expect(grenze != null && flaeche.contains(grenze), `Kachel „${name}“ ohne KachelGrenze`).toBe(
      true,
    );
    grenzen.add(grenze!);
  }
  expect(grenzen.size, 'jede Kachel in ihrer eigenen Grenze').toBe(kacheln.length);
}
