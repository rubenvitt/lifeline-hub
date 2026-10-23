/**
 * Zeitdarstellung dieses Geräts (localStorage), reaktiv über useSyncExternalStore — wie das
 * Koordinatensystem (`koordinatenSystemStore.ts`). LLH-1053, Entscheidung E3: Organisation und
 * Einsatz geben die Darstellung vor, das Gerät darf sie übersteuern; `null` folgt der Vorgabe.
 * Der Druck nimmt die Wahl nie (E4, `wirksameZeitdarstellung`).
 *
 * Persistent wie das Koordinatensystem: eine gesetzte Wahl gilt, bis sie zurückgestellt wird.
 * Versagt der Speicher (voll oder gesperrt), trägt das Modul die Wahl (LFH-942): sie wirkt sofort
 * in allen Abonnenten und bis zum Neuladen.
 */
import { useSyncExternalStore } from 'react';
import type { Zeitdarstellung } from '../api/types';
import { sicherEntfernen, sicherLesen, sicherSchreiben } from '../lib/sichererSpeicher';

const KEY = 'lifeline.zeitdarstellung';
const GUELTIG: readonly Zeitdarstellung[] = ['taktisch', 'datum_uhrzeit'];
const listeners = new Set<() => void>();

/** Die Wahl, die der Speicher nicht aufnahm; `undefined`, solange er sie trägt. */
let gewaehlt: Zeitdarstellung | null | undefined;

function lies(): Zeitdarstellung | null {
  if (gewaehlt !== undefined) return gewaehlt;
  const v = sicherLesen(KEY);
  return v && (GUELTIG as readonly string[]).includes(v) ? (v as Zeitdarstellung) : null;
}
function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Setzt die Wahl dieses Geräts; `null` stellt auf die Vorgabe von Einsatz und Organisation. */
export function setzeZeitdarstellung(art: Zeitdarstellung | null): void {
  const gespeichert = art == null ? sicherEntfernen(KEY) : sicherSchreiben(KEY, art);
  gewaehlt = gespeichert ? undefined : art;
  listeners.forEach((l) => l());
}

/** Die Wahl dieses Geräts, `null` = keine (es gilt die Vorgabe). */
export function useZeitdarstellungGeraet(): Zeitdarstellung | null {
  return useSyncExternalStore(subscribe, lies, () => null);
}

/** Nur für Tests: vergisst die Wahl im Modul, damit der nächste Test vom Speicher liest. */
export function zeitdarstellungVergessenFuerTests(): void {
  gewaehlt = undefined;
}
