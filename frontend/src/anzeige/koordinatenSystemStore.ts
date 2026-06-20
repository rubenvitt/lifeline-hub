/**
 * Globaler Koordinatensystem-Override (localStorage). Übersteuert die effektive
 * Anzeige-/Eingabe-Konvention app-weit — Anwender wählt das System einmal, nicht je
 * Feld. Reaktiv über useSyncExternalStore.
 *
 * Semantik: localStorage ist PERSISTENT (überlebt Browser-Neustarts, nicht nur die
 * Session). Ein einmal gesetzter Override übersteuert damit dauerhaft einen später
 * geänderten Org-Default, bis der Anwender ihn wieder auf den Org-Wert zurückstellt.
 * Bewusst so gewählt (User-Entscheidung). Für „nur bis Tab-Ende" wäre sessionStorage
 * der Tausch.
 */
import { useSyncExternalStore } from 'react';
import type { Koordinatenformat } from '../api/types';

const KEY = 'lifeline.koordinatensystem';
const GUELTIG: readonly Koordinatenformat[] = ['wgs84', 'dms', 'utm', 'mgrs', 'gk'];
const listeners = new Set<() => void>();

function lies(): Koordinatenformat | null {
  const v = localStorage.getItem(KEY);
  return v && (GUELTIG as readonly string[]).includes(v) ? (v as Koordinatenformat) : null;
}
function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
export function setzeOverride(system: Koordinatenformat | null): void {
  if (system == null) localStorage.removeItem(KEY);
  else localStorage.setItem(KEY, system);
  listeners.forEach((l) => l());
}
export function useKoordinatenSystemOverride(): Koordinatenformat | null {
  return useSyncExternalStore(subscribe, lies, () => null);
}
