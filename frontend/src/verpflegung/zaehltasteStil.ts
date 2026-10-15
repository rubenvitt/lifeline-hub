import type { CSSProperties } from 'react';

/**
 * Maße der Zähltasten der Ausgabeansicht (LLH-1032, design.md D9; `frontend/AGENTS.md`,
 * Bedien-Leitlinie „Dichte-Staffel“ und „Handgebautes Bedienziel“): reine Stilfunktion mit den
 * Böden als Literalen, aus den aufgelösten Tokens der Stufe.
 *
 * - **„+1“** ist die Zähltaste einer Hochfrequenz-Erfassung: in jeder Stufe mindestens 72 px hoch
 *   und breit (`Math.max(72, controlHeight)`), am unteren Rand. Eine Ausnahme nach oben, keine
 *   Stufenwahl: `handschuh` wird nie abgeleitet (Spec `bedien-dichte`).
 * - **Alle übrigen** („+5“, „+10“, „Menge …“, „−1“, Sonderkost, „Buchen“) folgen der Staffel
 *   (`controlHeight` 30 / 48 / 72), Abstand `marginSM` (16 px in `handschuh`).
 *
 * Kein `size="small"` (`components/dichte.guard.test.ts`).
 */
export type Zaehltaste = 'plus1' | 'uebrige';

/** Boden der Taste „+1“ in jeder Stufe. */
const PLUS1_BODEN = 72;

export function zaehltasteStil(
  token: { controlHeight: number },
  art: Zaehltaste,
): Pick<CSSProperties, 'minHeight' | 'minWidth'> {
  const hoehe = art === 'plus1' ? Math.max(PLUS1_BODEN, token.controlHeight) : token.controlHeight;
  return { minHeight: hoehe, minWidth: hoehe };
}

/** Abstand zwischen zwei Zähltasten: `marginSM` (7 / 11 / 16 px). */
export function zaehltastenAbstand(token: { marginSM: number }): number {
  return token.marginSM;
}
