/**
 * Globaler Koordinatensystem-Override (localStorage), reaktiv über useSyncExternalStore: der
 * Anwender wählt das System einmal, nicht je Feld.
 * localStorage ist bewusst PERSISTENT: ein gesetzter Override übersteuert auch einen später
 * geänderten Org-Default, bis er zurückgestellt wird.
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
  return () => {
    listeners.delete(cb);
  };
}
export function setzeOverride(system: Koordinatenformat | null): void {
  if (system == null) localStorage.removeItem(KEY);
  else localStorage.setItem(KEY, system);
  listeners.forEach((l) => l());
}
export function useKoordinatenSystemOverride(): Koordinatenformat | null {
  return useSyncExternalStore(subscribe, lies, () => null);
}
