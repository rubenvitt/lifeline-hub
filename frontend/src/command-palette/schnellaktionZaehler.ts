/**
 * Der reine Kern der Zählung je Schnellaktion (y3zh5ymv D5, Spec `sprungpalette`, „Schnellaktionen
 * nach Nutzung geordnet“): kein Netz, kein React. Verdrahtung in `useSchnellaktionZaehler.ts`,
 * Ordnung in `befehle.ts`.
 *
 * Am Benutzer auf dem Server, nicht im Browserspeicher: am gemeinsamen Fükw-Rechner erbte die
 * nächste Schicht sonst die Zahlen der vorigen (Herleitung wie `zuletztBefehle.ts`).
 */

import type { BenutzerEinstellungen } from '../api/types';

/**
 * Der Schlüssel im Präferenz-Fach, byte-gleich zu `SCHLUESSEL_SCHNELLAKTIONEN_ZAEHLER` in
 * `src/benutzer_einstellungen/mod.rs` (WHITELIST: ein Tippfehler ist ein 400).
 */
export const SCHLUESSEL_SCHNELLAKTIONEN_ZAEHLER = 'schnellaktionen_zaehler';

/**
 * Höchste gezählte Zahl je Schnellaktion. Hält den Wert unter der Grenze des Servers (2000
 * Zeichen) und eine einmal gewohnte Folge stabil: wer oben angekommen ist, wird nicht endlos
 * weiter vorne.
 */
export const ZAEHLER_DECKEL = 9999;

/** Ausführungen je Befehls-Id einer Schnellaktion. */
export type Zaehlung = Readonly<Record<string, number>>;

/**
 * Liest die Zählung aus dem Serverstand. Der Wert ist serverseitig OPAKER Text: alles, was keine
 * positive ganze Zahl ist, fällt weg, zu große Zahlen werden gedeckelt.
 */
export function leseZaehler(stand: BenutzerEinstellungen | undefined): Record<string, number> {
  const roh = stand?.eintraege?.[SCHLUESSEL_SCHNELLAKTIONEN_ZAEHLER];
  if (!roh) return {};
  let wert: unknown;
  try {
    wert = JSON.parse(roh);
  } catch {
    return {};
  }
  if (wert === null || typeof wert !== 'object' || Array.isArray(wert)) return {};
  const zaehlung: Record<string, number> = {};
  for (const [id, anzahl] of Object.entries(wert as Record<string, unknown>)) {
    if (typeof anzahl !== 'number' || !Number.isInteger(anzahl) || anzahl < 1) continue;
    zaehlung[id] = Math.min(anzahl, ZAEHLER_DECKEL);
  }
  return zaehlung;
}

/**
 * Der neue Stand nach einer Ausführung von `id`. Ids, die `bekannt` nicht mehr führt (eine
 * entfallene Schnellaktion), fallen dabei weg; eine unbekannte `id` wird nicht gezählt.
 */
export function naechsterZaehler(
  vorher: Zaehlung,
  id: string,
  bekannt: readonly string[],
): Record<string, number> {
  const erlaubt = new Set(bekannt);
  const naechste: Record<string, number> = {};
  for (const [k, v] of Object.entries(vorher)) if (erlaubt.has(k)) naechste[k] = v;
  if (erlaubt.has(id)) naechste[id] = Math.min((naechste[id] ?? 0) + 1, ZAEHLER_DECKEL);
  return naechste;
}

/**
 * Ordnet Zeilen nach ihrer Zählung, die häufigste zuerst. Stabil: bei Gleichstand, also auch
 * ganz ohne Zählung, bleibt die Folge der Eingabe (die feste Folge der Tabelle).
 */
export function ordneNachNutzung<T>(
  zeilen: readonly T[],
  id: (zeile: T) => string,
  zaehlung: Zaehlung,
): T[] {
  return zeilen
    .map((zeile, index) => ({ zeile, index, anzahl: zaehlung[id(zeile)] ?? 0 }))
    .sort((a, b) => b.anzahl - a.anzahl || a.index - b.index)
    .map((x) => x.zeile);
}
