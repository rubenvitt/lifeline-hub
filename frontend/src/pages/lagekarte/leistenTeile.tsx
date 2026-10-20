import type { CSSProperties } from 'react';
import { SeitenFehler } from '../../components/SeitenZustand';

/**
 * Bausteine, die mehrere Flächen der Kartenleiste teilen (Objekte-Ansicht in `Sidebar.tsx`,
 * `Ebenenbaum.tsx`, `BildHintergruende.tsx`). Eigene Datei, damit die Flächen einander nicht
 * importieren.
 */

/** Ein Fehler-Slot: was schiefging, woran es lag, und der Weg zurück. */
export interface SektionFehler {
  /** Aus Sicht der Einsatzkraft — kein Statuscode, kein Stacktrace. */
  text: string;
  /** Rohfehler der Query; das Primitiv filtert selbst auf `ApiError`. */
  ursache?: unknown;
  onWiederholen?: () => void;
}

/** Ein Fehler-Slot als Markup — oder nichts. */
export function FehlerSlot({ fehler }: { fehler?: SektionFehler }) {
  if (!fehler) return null;
  return (
    <SeitenFehler
      text={fehler.text}
      ursache={fehler.ursache}
      onWiederholen={fehler.onWiederholen}
    />
  );
}

/**
 * Stil einer Ebenen-Zeile — ein handgebautes Bedienziel (`<button role="switch">`): `minHeight` aus
 * `controlHeight` plus Polsterung. Rein und exportiert.
 */
export function ebenenZeileStil(token: {
  controlHeight: number;
  paddingSM: number;
  padding: number;
  marginSM: number;
}): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: token.marginSM,
    width: '100%',
    minHeight: token.controlHeight,
    padding: `${token.paddingSM}px ${token.padding}px`,
    margin: 0,
    border: 0,
    cursor: 'pointer',
    textAlign: 'start',
  };
}

/**
 * Eine Schalter-Zeile der Leiste, die umbrechen darf: der Kippschalter ist im Handschuh 144 px
 * breit, nach der Polsterung bleiben 247 px — eine starre Zeile ließe dem Namen 19 px. Mit {@link
 * namensteilStil} rückt der Namensteil in eine eigene Zeile, sobald neben dem Schalter kein Platz
 * bleibt; in kompakt und komfortabel bleibt es eine Zeile. Das folgt aus dem Layout, nicht aus
 * einer Stufenabfrage. Heute trägt sie die Zeile eines Bild-Hintergrunds (`BildHintergruende.tsx`);
 * die Ebenen sind selbst Schalter (`Ebenenbaum.tsx`). Nachweis: `e2e/lagekarte-leiste-dichte.spec.ts`.
 */
export function leistenZeileStil(token: { marginXS: number }) {
  return {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    gap: token.marginXS,
  } as const;
}

/**
 * Der Namensteil einer {@link leistenZeileStil}-Zeile — Name und was ihm rechts folgt (Menü,
 * Statuswort) als eine Umbrucheinheit; getrennt umgebrochen rutschte das Menü allein in eine zweite
 * Zeile.
 *
 * Basis 0 plus Mindestbreite: das Element bricht um, sobald die Mindestbreite nicht mehr neben die
 * Vorgänger passt. Boden ist `6em` Name plus ein Bedienziel der Stufe (`controlHeight`).
 */
export function namensteilStil(token: { controlHeight: number; marginXS: number }) {
  return {
    display: 'flex',
    alignItems: 'flex-start',
    gap: token.marginXS,
    flex: '1 1 0',
    minWidth: `calc(6em + ${token.controlHeight}px)`,
  } as const;
}
