import { useSyncExternalStore } from 'react';

/**
 * Fensterhöhe, unter der die ETB-Erfassung ab `md` einzeilig wird (Change
 * `kwc2yszv-etb-neuentwurf`, Spec `etb-schnellerfassung-tastatur`, „Einstellungen in der Fußzeile
 * der Erfassung“): Feldzeile und Fußzeile kosteten im Handschuh-Betrieb vier Reihen, bei 1366 × 520
 * fast 70 % der Fensterhöhe (`e2e/fokus-verdeckung.spec.ts`). Der Fükw mit 768 px und das Tablet
 * quer liegen darüber.
 */
export const NIEDRIG_UNTER = 700;

const ABFRAGE = `(max-height: ${NIEDRIG_UNTER - 1}px)`;

function abonniere(melde: () => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const mql = window.matchMedia(ABFRAGE);
  mql.addEventListener('change', melde);
  return () => mql.removeEventListener('change', melde);
}

function istNiedrig(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(ABFRAGE).matches;
}

/** Ist das Fenster niedriger als {@link NIEDRIG_UNTER}? */
export function useNiedrigesFenster(): boolean {
  return useSyncExternalStore(abonniere, istNiedrig, () => false);
}
