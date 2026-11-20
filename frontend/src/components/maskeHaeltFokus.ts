import type { MouseEvent } from 'react';

/**
 * `wrapProps` für Dialoge, deren Maske nicht schließt (LLH-1755): ein Klick oder Tap auf die Maske
 * verschiebt den Fokus sonst auf `<body>`. Dort hört keine Tastatur-Ebene mehr Escape, der Dialog
 * stünde offen und taub. Nur ein Druck direkt auf die Maske, nicht auf den Dialog darin.
 */
export const MASKE_HAELT_FOKUS = {
  onMouseDown: (e: MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) e.preventDefault();
  },
};
