import { useMemo } from 'react';
import type { KarteServerConfig } from '../../api/karte';
import {
  baueBasemapStyle,
  aktuelleAttribution,
  loeseKartenTheme,
  type BasemapModus,
  type KartenTheme,
  type KartenThemeWahl,
} from './basemapStil';

interface BasemapArgs {
  /** Effektive (anzuzeigende) Basemap inkl. Style-Fallback — kommt aus useKartenAnsicht. */
  basemap: BasemapModus;
  onlineStilName: string | null;
  kartenTheme: KartenThemeWahl;
  config: KarteServerConfig | undefined;
  /** Effektives App-Theme ('light'/'dark') zur Auflösung der 'auto'-Kartenwahl. */
  effektiv: KartenTheme;
}

/**
 * Basemap-Ableitung der Lagekarte: baut aus der Kartenwahl (gehalten in `useKartenAnsicht`) die
 * MapLibre-Style- und Attributions-Bausteine. Kein eigener State — die geteilte Kartenansicht ist
 * die Wahrheit. Die Fachebenen-Attribution mergt die Seite (`basisAttribution` +
 * `fachebenenAttribution`).
 */
export function useBasemap({
  basemap,
  onlineStilName,
  kartenTheme,
  config,
  effektiv,
}: BasemapArgs) {
  const onlineStil = useMemo(() => {
    const liste = config?.online_styles ?? [];
    return liste.find((s) => s.name === onlineStilName) ?? liste[0];
  }, [config, onlineStilName]);

  // Karten-lokale Wahl gegen das App-Theme auflösen ('auto' → App-Theme).
  const kartenThemeEffektiv = loeseKartenTheme(kartenTheme, effektiv);
  const style = useMemo(
    () => baueBasemapStyle(basemap, kartenThemeEffektiv, config, onlineStil),
    [basemap, kartenThemeEffektiv, config, onlineStil],
  );

  // Basisbaustein der Attribution (ohne Fachebenen) — die Page mergt ihn mit fachebenenAttribution.
  const basisAttribution = useMemo(
    () => aktuelleAttribution(basemap, onlineStil, config),
    [basemap, onlineStil, config],
  );

  return { onlineStil, style, basisAttribution };
}
