/**
 * Globaler Koordinatensystem-Override (localStorage), reaktiv über useSyncExternalStore: der
 * Anwender wählt das System einmal, nicht je Feld.
 * localStorage ist bewusst PERSISTENT: ein gesetzter Override übersteuert auch einen später
 * geänderten Org-Default, bis er zurückgestellt wird.
 *
 * Versagt der Speicher (voll oder gesperrt), trägt das Modul die Wahl (LFH-942, design.md D3):
 * Sie wirkt trotzdem sofort in allen Abonnenten und bis zum Neuladen.
 */
import { useSyncExternalStore } from 'react';
import type { Koordinatenformat } from '../api/types';
import { sicherEntfernen, sicherLesen, sicherSchreiben } from '../lib/sichererSpeicher';

const KEY = 'lifeline.koordinatensystem';
const GUELTIG: readonly Koordinatenformat[] = ['wgs84', 'dms', 'utm', 'mgrs', 'gk'];
const listeners = new Set<() => void>();

/** Die Wahl, die der Speicher nicht aufnahm; `undefined`, solange er sie trägt. */
let gewaehlt: Koordinatenformat | null | undefined;

function lies(): Koordinatenformat | null {
  if (gewaehlt !== undefined) return gewaehlt;
  const v = sicherLesen(KEY);
  return v && (GUELTIG as readonly string[]).includes(v) ? (v as Koordinatenformat) : null;
}
function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
export function setzeOverride(system: Koordinatenformat | null): void {
  const gespeichert = system == null ? sicherEntfernen(KEY) : sicherSchreiben(KEY, system);
  gewaehlt = gespeichert ? undefined : system;
  listeners.forEach((l) => l());
}
export function useKoordinatenSystemOverride(): Koordinatenformat | null {
  return useSyncExternalStore(subscribe, lies, () => null);
}

/** Nur für Tests: vergisst die Wahl im Modul, damit der nächste Test vom Speicher liest. */
export function koordinatenSystemVergessenFuerTests(): void {
  gewaehlt = undefined;
}
