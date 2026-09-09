import type { CSSProperties } from 'react';
import type { AbBreitePunkt } from '../components/useViewport';

/**
 * Ab welcher antd-Stufe die Aktionen des Befehlsentwurfs im Kopf stehen statt am unteren
 * Rand zu kleben (LFH-465, Nachzug aus LFH-343 · C8).
 *
 * `lg` = 992 ist die letzte antd-Stufe unterhalb des Führungs-Tablets (1024–1280 px,
 * Bedien-Leitlinie LFH-327) — genau der „Tablet-Breakpoint" aus dem Akzeptanzkriterium.
 * Die Zahl steht bewusst NICHT hier: `useViewport.ts` hält im Dateikopf fest, dass die
 * Schwellen aus antd kommen und nicht gespiegelt werden; ein handgeschriebenes `1024`
 * wäre die zweite Wahrheit, gegen die der Viewport-Guard gebaut ist. 1024 ist deshalb im
 * e2e die Probe knapp OBERHALB der Schwelle, kein Wert im Produktivcode.
 *
 * Wer das auf `xl` (1200) hebt, verankert die Leiste auch auf dem Führungs-Tablet — dort
 * trägt die Kopfzeile die vier Aktionen gemessen ohne Umbruch, und die Leiste wäre eine
 * Verdeckungsquelle ohne Anlass.
 */
export const AKTIONSLEISTE_AB: AbBreitePunkt = 'lg';

/**
 * Stil der Aktionszeile des Befehlsentwurfs — REIN und exportiert nach dem Muster von
 * `bedienzielStil` (LFH-365) und `speicherLeisteStil` (LFH-345 · C10), damit die
 * Ungleichheit über beide Breitenzweige ohne Render prüfbar ist (jsdom rechnet kein
 * Layout).
 *
 * `verankert` ist die Aussage, nicht der Sticky-Zweig für sich: oberhalb der Schwelle
 * gehören dieselben Aktionen in den Kopf-`Flex` und dürfen dort KEINE eigene Fläche mit
 * Trennlinie aufziehen.
 *
 * Eigener Grund und Trennlinie im verankerten Zweig, weil die Leiste über gerendertem
 * Markdown liegt: eine durchsichtige Leiste dort ist von „nicht da" nicht zu
 * unterscheiden. `zIndex: 1` reicht — der Editor zieht keinen eigenen Stapelkontext auf.
 */
export function aktionsleisteStil(
  verankert: boolean,
  token: { colorBgContainer: string; paddingSM: number; colorBorderSecondary: string },
): CSSProperties {
  if (!verankert) return {};
  return {
    position: 'sticky',
    bottom: 0,
    zIndex: 1,
    background: token.colorBgContainer,
    paddingBlock: token.paddingSM,
    borderTop: `1px solid ${token.colorBorderSecondary}`,
  };
}
