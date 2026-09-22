import type { CSSProperties } from 'react';
import { useThemeMode } from '../theme/ThemeModeProvider';
import { farbenDunkel, farbenHell, schrift, schriftskala, type Farbrollen } from '../theme/tokens';

/*
 * Kleine, abhängigkeitsarme Stilhelfer des Rahmens (Neuentwurf „Instrumententafel"),
 * geteilt von Modulpanel, Drawer-Akkordeon, Seitenkopf und Sprungpalette. Eigene Datei
 * statt `Kopfleiste.tsx`: die Palette soll dafür nicht Auth, Live-Store und Offline-Queue
 * mitladen.
 */

/**
 * Die Farbrollen des AKTIVEN Modus — für die Flächen des Rahmens, die dem Modus folgen
 * (Modulpanel `paneel`, Seitenkopf-Haarlinie). antd kennt `paneel`/`flaeche3`/`text2` nicht
 * als Token; der Modus kommt deshalb aus `useThemeMode` (außerhalb des Providers: Nacht, die
 * Vorgabe). Kopf und Rail lesen dagegen `rahmenFarben` — sie sind in beiden Modi dunkel.
 */
export function useModusFarben(): Farbrollen {
  const { effektiv } = useThemeMode();
  return effektiv === 'dark' ? farbenDunkel : farbenHell;
}

/**
 * Augenbraue (10 px, 600, Versalien, Sperrung .14em, `schwach`) — `schriftskala.augenbraue`.
 * Rein und exportiert: dieselbe Stufe steht im Modulpanel, im Drawer und in der Palette.
 */
export function augenbraueStil(farbe: string): CSSProperties {
  const stufe = schriftskala.augenbraue;
  return {
    fontFamily: schrift[stufe.familie],
    fontSize: stufe.groesse,
    fontWeight: stufe.gewicht,
    letterSpacing: stufe.sperrung,
    textTransform: 'uppercase',
    color: farbe,
  };
}
