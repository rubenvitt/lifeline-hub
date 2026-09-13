import type { CSSProperties } from 'react';

/**
 * Trefffläche der handgebauten Bedienziele der Stab-Seite (Werkzeug-Links; in ST5/ST6 auch
 * ETB-Link und Kennzahl-Deeplinks). Schablone `bedienzielStil` (`pages/lagekarte/Sidebar.tsx`),
 * aber `inline-flex`: die Links stehen in einer Textzeile.
 *
 * ZWEI Angaben, nicht eine (LFH-365): die Polsterung allein trägt den Boden nicht. Aufgelöste
 * Tokens aus `theme.useToken()`, nie `var(--lfh-*)`. Eigener Name, weil `zeilenzielStil` in
 * `pages/einstellungen/Anmeldeverfahren.tsx` schon exportiert ist (dort `display: 'flex'`).
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
