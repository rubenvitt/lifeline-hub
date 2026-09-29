import type { CSSProperties } from 'react';
import type { AbBreitePunkt } from '../components/useViewport';

/**
 * Ab welcher antd-Stufe die Aktionen des Befehlsentwurfs im Kopf stehen statt am unteren
 * Rand zu kleben (LFH-465). `lg` ist die letzte Stufe unterhalb des Führungs-Tablets; auf
 * dem Tablet trägt die Kopfzeile die Aktionen ohne Umbruch. Keine Pixelzahl hier: die
 * Schwellen kommen aus antd (`useViewport.ts`).
 */
export const AKTIONSLEISTE_AB: AbBreitePunkt = 'lg';

/**
 * Stil der Aktionszeile des Befehlsentwurfs — rein und exportiert, damit beide Breitenzweige
 * ohne Render prüfbar sind. Oberhalb der Schwelle stehen die Aktionen im Kopf-`Flex` ohne
 * eigene Fläche; verankert tragen sie eigenen Grund und Trennlinie, weil eine durchsichtige
 * Leiste über Markdown von „nicht da" nicht zu unterscheiden ist.
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
