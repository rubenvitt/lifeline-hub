import type { CSSProperties } from 'react';

/*
 * Das Sammelformular der Personendaten ist mit LLH-1103 entfallen (Personendaten feldweise,
 * `personen/Personendaten.tsx`); geblieben ist der Stil des Verorten-Links neben der Koordinate.
 */

/**
 * „Auf Lagekarte verorten" ist ein handgebautes Bedienziel (ein `<a>` erbt keine Steuerhöhe):
 * `minHeight` aus der Dichtestufe plus Polsterung. Farbe `bedienText`, die Rolle für blauen
 * TEXT; seit LFH-652 wertgleich mit antds `colorLink`.
 */
export function verortenLinkStil(
  token: { controlHeight: number; paddingSM: number },
  bedienText: string,
): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    minHeight: token.controlHeight,
    paddingInline: token.paddingSM,
    color: bedienText,
  };
}
