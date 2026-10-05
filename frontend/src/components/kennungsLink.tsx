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

interface KennungsLinkProps extends LinkProps {
  /**
   * Kleine Steuerhöhe (`controlHeightSM`, 24 / 48 / 72) statt `controlHeight`: für Knoten eines
   * antd-`Tree`, dessen Zeile `titleHeight` = `controlHeightSM` trägt. Mit dem großen Boden stünde
   * der Knoten in `kompakt` 30 px hoch und der Klapppfeil über der Textmitte.
   */
  klein?: boolean;
}

/**
 * Ein `<Link>` mit dem Boden aus {@link kennungsLinkStil}. Liest das Token selbst, damit
 * Spalten-`render` und Hilfsfunktionen ohne eigenes `useToken` auskommen. Ein übergebener
 * `style` legt sich darüber (Schrift, Farbe), den Boden überschreibt er nur ausdrücklich.
 *
 * Der Inhalt steht in EINER Hülle: als Flex-Kind wäre ein `Tag` blockifiziert und erbte die
 * Hover-Unterstreichung des Links (CSS Text Decoration 3); in der Hülle bleibt er ein atomares
 * Inline-Element, an das keine Unterstreichung weitergereicht wird.
 */
export function KennungsLink({ style, klein, children, ...rest }: KennungsLinkProps) {
  const { token } = theme.useToken();
  const boden = kennungsLinkStil({
    controlHeight: klein ? token.controlHeightSM : token.controlHeight,
  });
  return (
    <Link {...rest} style={{ ...boden, ...style }}>
      {/* `minWidth: 0`: als Flex-Kind läge der Boden sonst bei der längsten Zeile des Inhalts, und
          eine abgeschnittene Zelle (Kräfteübersicht, `-webkit-box`) spannte die Spalte wieder auf. */}
      <span style={{ minWidth: 0 }}>{children}</span>
    </Link>
  );
}
