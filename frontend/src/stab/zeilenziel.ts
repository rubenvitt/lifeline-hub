import type { CSSProperties } from 'react';

/**
 * Trefffläche der handgebauten Bedienziele der Stab-Seite (Werkzeug-, ETB- und
 * Kennzahl-Links). Schablone `bedienzielStil`, aber `inline-flex`, weil die Links in einer
 * Textzeile stehen. ZWEI Angaben — die Polsterung allein trägt den Boden nicht; aufgelöste
 * Tokens, nie `var(--lfh-*)`. Eigener Name, weil `zeilenzielStil` schon exportiert ist.
 *
 * Bewusst OHNE Farbe: der Link erbt antds `colorLink` = `bedienText` (frontend/AGENTS.md,
 * Farbachsen). Kontrast in Ruhe und unter dem Zeiger: `e2e/stab-kontrast.spec.ts` (LFH-695).
 */
export function stabZeilenzielStil(token: {
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
