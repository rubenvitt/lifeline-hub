import type { Spezies, Tier } from '../../api/types';

/**
 * Filterkette der Tierliste als reine Funktion (LFH-330 · B2, Muster
 * `pages/schaeden/schadenHelfer.tsx`).
 *
 * Kein Suchanteil: die Freitextsuche hängt am `suchText` der Spalten und läuft im
 * `Datensicht`-Primitiv. Der Spezies-Filter bleibt dagegen eine SEITEN-Steuerung neben den
 * Reitern (und wird nicht zu einem Spalten-`filter`), weil er zusammen mit der Statusachse
 * gelesen wird — wie die Filterkarte der Kräfteübersicht außerhalb ihrer Sicht liegt.
 */

/** Status-Sichten: 'alle' = kein Filter; sonst Status-Filter. */
export type TiereSicht = 'aktiv' | 'vermisst' | 'abgeschlossen' | 'alle';

/**
 * Zeilenmenge aus Statussicht UND Spezies — eine SCHNITTMENGE, keine Vereinigung: wer
 * „vermisste Katzen" wählt, will nicht auch alle vermissten Hunde sehen.
 */
export function filterTiere(
  alle: readonly Tier[],
  opts: { sicht: TiereSicht; spezies?: Spezies },
): readonly Tier[] {
  const { sicht, spezies } = opts;
  return alle
    .filter((t) => sicht === 'alle' || t.status === sicht)
    .filter((t) => !spezies || t.spezies === spezies);
}
