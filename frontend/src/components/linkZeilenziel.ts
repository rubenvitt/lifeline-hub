import type { CSSProperties } from 'react';

/**
 * Trefffläche handgebauter Links, die in einer Textzeile stehen (Verlauf der Lagebesprechung,
 * Informationstelefon, Funkplan, Kommunikationsplan). Schablone `bedienzielStil`, aber
 * `inline-flex`, weil die Links in einer
 * Textzeile stehen. ZWEI Angaben — die Polsterung allein trägt den Boden nicht; aufgelöste
 * Tokens, nie `var(--lfh-*)`. Eigener Name, weil `zeilenzielStil` schon exportiert ist.
 *
 * Bewusst OHNE Farbe: der Link erbt antds `colorLink` = `bedienText` (frontend/AGENTS.md,
 * Farbachsen). Kontrast in Ruhe und unter dem Zeiger: `e2e/lagebesprechung.spec.ts` (LFH-695).
 */
export function linkZeilenzielStil(token: {
  controlHeight: number;
  paddingSM: number;
  padding: number;
}): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    minHeight: token.controlHeight,
    padding: `${token.paddingSM}px ${token.padding}px`,
  };
}
