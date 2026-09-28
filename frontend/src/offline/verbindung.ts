import { useSyncExternalStore } from 'react';
import { ApiError, NetzFehler } from '../api/client';
import { useOnline } from './useOnline';

/**
 * Ist der Server erreichbar? (LFH-723, design.md D7)
 *
 * `navigator.onLine` allein trägt die Offline-Kennzeichnung nicht: er sagt „das Gerät hat ein
 * Netz", nicht „der Server antwortet". Im Feld steht das WLAN oft, während der Fükw-Server
 * dahinter weg ist — und gemessen meldet Chromium nach einem Neuladen unter Playwrights
 * Offline-Schalter `onLine === true`, obwohl jeder Abruf scheitert. Der zweite Kanal ist
 * deshalb die Erfahrung der App selbst: ein Abruf, der an der LEITUNG scheitert, meldet
 * „nicht erreichbar", jede erfolgreiche Server-Antwort hebt das auf. Eine fachliche Ablehnung
 * (403, 500 …) ist eine Antwort und ändert nichts.
 *
 * Gemeldet wird vom QueryClient (`api/queryClient.ts`, schon beim ERSTEN gescheiterten
 * Versuch, nicht erst nach den Wiederholungen) und von der Sitzungsprüfung beim Start.
 */

/** Gateway-Antworten, mit denen ein vorgeschalteter Proxy „Server nicht erreichbar" meldet. */
const GATEWAY_NICHT_ERREICHBAR = new Set([502, 503, 504]);

/** Ein Leitungsfehler — kein Server hat fachlich geantwortet. */
export function istVerbindungsfehler(fehler: unknown): boolean {
  if (fehler instanceof NetzFehler) return true;
  return fehler instanceof ApiError && GATEWAY_NICHT_ERREICHBAR.has(fehler.status);
}

let erreichbar = true;
const hoerer = new Set<() => void>();

export function meldeServerErreichbar(ja: boolean): void {
  if (erreichbar === ja) return;
  erreichbar = ja;
  for (const h of hoerer) h();
}

function abonnieren(h: () => void) {
  hoerer.add(h);
  return () => {
    hoerer.delete(h);
  };
}

export function useServerErreichbar(): boolean {
  return useSyncExternalStore(
    abonnieren,
    () => erreichbar,
    () => true,
  );
}

/** Ohne Verbindung: der Browser ist offline ODER der Server antwortet nicht. */
export function useOhneVerbindung(): boolean {
  const online = useOnline();
  const serverErreichbar = useServerErreichbar();
  return !online || !serverErreichbar;
}

/** Nur für Tests: der Zustand ist modulweit und überlebte sonst den Test. */
export function verbindungZuruecksetzenFuerTests(): void {
  erreichbar = true;
  for (const h of hoerer) h();
}
