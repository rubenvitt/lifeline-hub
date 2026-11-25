/**
 * Alter einer Position an Einheit, Fahrzeug oder Person (Helfer-App, Spec
 * `docs/superpowers/specs/2026-11-24-vakwvkpg-helfer-app-design.md`, „Positionsbaustein“).
 */

/** Ab diesem Alter (Minuten, einschließlich) gilt eine Position als „veraltet“ und wird blass. */
export const VERALTET_AB_MIN = 5;

export interface PositionsAlter {
  /** Volle Minuten seit dem Zeitpunkt; angebrochene zählen nicht, die Zukunft zählt als 0. */
  minuten: number;
  veraltet: boolean;
}

/**
 * Liest `position_aktualisiert_at` (UTC, kanonisch `YYYY-MM-DD HH:MM:SS` oder RFC 3339) gegen
 * `jetzt`. Ohne oder mit unlesbarem Zeitpunkt `null`: dann steht keine Angabe da, keine geratene.
 * Ein Zeitpunkt in der Zukunft (Uhrenversatz Server ↔ Browser) ist 0 min alt.
 */
export function positionsAlter(
  aktualisiertAt: string | null | undefined,
  jetzt: Date,
): PositionsAlter | null {
  const t = parseZeitpunkt(aktualisiertAt);
  if (t == null) return null;
  const minuten = Math.floor(Math.max(0, jetzt.getTime() - t) / 60_000);
  return { minuten, veraltet: minuten >= VERALTET_AB_MIN };
}

/**
 * Millisekunden eines Serverzeitpunkts: das kanonische Format trägt keine Zone und meint UTC,
 * RFC 3339 bleibt, wie es ist. Leer oder unlesbar `null`. Auch für den Stand eines Lage-Snapshots,
 * gegen den der Rückblick das Alter misst.
 */
export function parseZeitpunkt(s: string | null | undefined): number | null {
  if (!s) return null;
  const kanonisch = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/.exec(s);
  const t = Date.parse(kanonisch ? `${kanonisch[1]}T${kanonisch[2]}Z` : s);
  return Number.isNaN(t) ? null : t;
}
