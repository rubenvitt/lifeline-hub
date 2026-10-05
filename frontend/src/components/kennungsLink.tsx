import { theme } from 'antd';
import type { CSSProperties } from 'react';
import { Link, type LinkProps } from 'react-router';

/**
 * Trefffläche eines Kennungs-Links in einer Tabellen-, Listen- oder Zeitachsenzeile (LFH-908):
 * der Funkrufname in der Katalogtabelle, „Meldung #1“ in der Zeitachse, „↗ Auftrag“ in einer
 * Karte. Ein `<a>` erbt keine Steuerhöhe (`frontend/AGENTS.md`, „Handgebautes Bedienziel“);
 * nackt maß ein solcher Link im Handschuh 13–17 px.
 *
 * Schablone `bedienzielStil`, aber `inline-flex`, weil der Link in der Zelle bzw. Textzeile
 * steht, und OHNE eigene Polsterung: die trägt die Zelle (antds Zellpolster, die Rinne der
 * Zeile). Senkrecht höbe sie den Link im `content-box`-Modell über `controlHeight` und damit
 * die Zeile über ihre Zeilenknöpfe; waagerecht rückte die Kennung aus der Flucht des
 * Spaltenkopfs. So misst der Link genau die Steuerhöhe der Stufe — Nachweis
 * `e2e/verwaltung-vereinheitlicht.spec.ts` (Gleichheit mit „Bearbeiten“) und
 * `e2e/trefflaeche-pruefflaechen.spec.ts` (C13, Lagemeldungen).
 *
 * Bewusst OHNE Farbe: der Link erbt antds `colorLink` = `bedienText`. Rein und exportiert,
 * aufgelöste Tokens, nie `var(--lfh-*)`.
 */
export function kennungsLinkStil(token: { controlHeight: number }): CSSProperties {
  return { display: 'inline-flex', alignItems: 'center', minHeight: token.controlHeight };
}

/**
 * Ein `<Link>` mit dem Boden aus {@link kennungsLinkStil}. Liest das Token selbst, damit
 * Spalten-`render` und Hilfsfunktionen ohne eigenes `useToken` auskommen. Ein übergebener
 * `style` legt sich darüber (Schrift, Farbe), den Boden überschreibt er nur ausdrücklich.
 */
export function KennungsLink({ style, ...rest }: LinkProps) {
  const { token } = theme.useToken();
  return <Link {...rest} style={{ ...kennungsLinkStil(token), ...style }} />;
}
