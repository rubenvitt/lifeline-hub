/**
 * Ist im Tab gerade ein Einsatz-Strom offen? (LFH-734)
 *
 * Der Einsatz-Strom trägt die Org-Ereignisse mit. Solange er offen ist, ruht der Org-Strom
 * `/api/live` (`useOrgLiveStream`), damit ein Tab bei EINER SSE-Verbindung bleibt
 * (HTTP/1.1-Grenze, `useEinsatzLiveStream.ts`). Gezählt statt als Flag, weil sich beim Wechsel
 * zwischen zwei Einsätzen Auf- und Abbau kurz überlappen können.
 */
let offen = 0;
const beobachter = new Set<() => void>();

function benachrichtige(): void {
  beobachter.forEach((b) => b());
}

/** Meldet einen offenen Einsatz-Strom an; die Rückgabe meldet ihn wieder ab. */
export function meldeEinsatzStrom(): () => void {
  offen += 1;
  benachrichtige();
  let abgemeldet = false;
  return () => {
    if (abgemeldet) return;
    abgemeldet = true;
    offen -= 1;
    benachrichtige();
  };
}

export function einsatzStromOffen(): boolean {
  return offen > 0;
}

/** Für `useSyncExternalStore`. */
export function beobachteEinsatzStrom(beobachten: () => void): () => void {
  beobachter.add(beobachten);
  return () => beobachter.delete(beobachten);
}
