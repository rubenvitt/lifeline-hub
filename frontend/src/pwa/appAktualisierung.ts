/** Rückgabefunktion von `registerSW`; der boolesche Parameter fordert den Reload an. */
export type AppAktualisierer = (neuLaden?: boolean) => Promise<void>;

let aktualisierer: AppAktualisierer | null = null;
let verfuegbar = false;
const hoerer = new Set<() => void>();

function benachrichtige(): void {
  hoerer.forEach((horcher) => horcher());
}

/** Verbindet den UI-neutralen Store mit der von vite-plugin-pwa erzeugten Funktion. */
export function setzeAppAktualisierer(naechster: AppAktualisierer | null): void {
  aktualisierer = naechster;
}

/** Callback für `registerSW({ onNeedRefresh })`; Zustand bleibt bis zum UI-Mount erhalten. */
export function meldeAppAktualisierungVerfuegbar(): void {
  if (verfuegbar) return;
  verfuegbar = true;
  benachrichtige();
}

export function verwerfeAppAktualisierung(): void {
  if (!verfuegbar) return;
  verfuegbar = false;
  benachrichtige();
}

/** `useSyncExternalStore`-Seam für die eine globale Betriebszeile. */
export function abonniereAppAktualisierung(horcher: () => void): () => void {
  hoerer.add(horcher);
  return () => hoerer.delete(horcher);
}

export function istAppAktualisierungVerfuegbar(): boolean {
  return verfuegbar;
}

/** Installiert ausschließlich nach ausdrücklichem Bediener-Klick und fordert dann Reload an. */
export async function aktualisiereAppJetzt(): Promise<void> {
  if (!aktualisierer) return;
  await aktualisierer(true);
  verwerfeAppAktualisierung();
}
