import type { CSSProperties } from 'react';

/** Schriftgröße der Zeile „Als Einheit übernommen: …“, wie die übrigen Zusatzzeilen der Karte. */
export const EINHEITEN_SCHRIFT = 13;

/**
 * Aufbau der Zeile „Als Einheit übernommen: 83-1 ↗, 83-2 ↗“ (LLH-1410) — rein und exportiert,
 * über das Token wie `zeitachsenAufbau`, nicht über `useDichte()`.
 *
 * Mit dem Boden aus `KennungsLink` war jeder Link ein unteilbarer `inline-flex`-Block von
 * Steuerhöhe: in der schmalen Board-Spalte stand jeder auf einer eigenen Zeile, mit großem
 * Abstand dazwischen. Darum je Stufe:
 *
 * - unter 48 px Bedienhöhe (`kompakt`, Fükw mit Maus) `fliessend`: der Link bleibt ein
 *   Inline-Element und bricht wie der Satz um. Den Boden aus A1 Gate 3 (24 px =
 *   `controlHeightSM`) trägt eine senkrechte Polsterung; sie zählt zur Trefffläche, hebt die
 *   Zeile aber nicht (Inline-Box, CSS 2.1 § 10.6.1).
 * - sonst `gereiht` (Tablet, Handschuh): der Link behält den vollen Boden aus `KennungsLink`.
 *   Fließend griffe die Polsterung dort weit in die Nachbarzeile; die Reihen stehen als Flex mit
 *   Umbruch, damit Komma und Beschriftung am Link bleiben.
 */
export type EinheitenSprungAufbau = { art: 'fliessend'; link: CSSProperties } | { art: 'gereiht' };

export function einheitenSprungAufbau(token: {
  controlHeight: number;
  controlHeightSM: number;
  lineHeight: number;
}): EinheitenSprungAufbau {
  if (token.controlHeight >= 48) return { art: 'gereiht' };
  const zeile = EINHEITEN_SCHRIFT * token.lineHeight;
  return {
    art: 'fliessend',
    link: { display: 'inline', paddingBlock: Math.max(0, (token.controlHeightSM - zeile) / 2) },
  };
}
