import type { KarteServerConfig } from '../../api/karte';
import { defaultModus, type BasemapModus, type KartenThemeWahl } from './basemapStil';

/** Pro Einsatz gemerkte Kartenwahl (Modus + Online-View + Karten-Theme). */
export interface GespeicherteBasemap {
  modus: BasemapModus;
  /** Name des Online-Views; nur für `modus === 'online'` relevant, sonst null. */
  onlineView: string | null;
  /** Karten-lokale Theme-Wahl; 'auto' folgt dem App-Theme (LFH-197). */
  kartenTheme: KartenThemeWahl;
}

const kartenThemeGueltig = (w: unknown): w is KartenThemeWahl =>
  w === 'auto' || w === 'light' || w === 'dark';

/**
 * Wählt die initiale Kartenwahl für den Einstieg in die Lagekarte.
 * Priorität: gemerkte Wahl (localStorage) → Einsatz-Default (LFH-131) →
 * Verfügbarkeits-Default (online → offline → blind). Jede Stufe wird gegen die
 * aktuelle Server-Config validiert; ungültige Stufen werden übersprungen.
 *
 * Gültigkeitsprüfung gegen die Config, weil sich Verfügbarkeit/Views serverseitig
 * geändert haben können (z. B. Offline gemerkt, aber offline nicht mehr verfügbar;
 * Online-View gemerkt, aber umbenannt/entfernt).
 */
export function waehleInitialeBasemap(
  config: KarteServerConfig,
  gespeichert: GespeicherteBasemap | null,
  einsatzDefault: BasemapModus | null = null,
): GespeicherteBasemap {
  const hatOnline = config.online_styles.length > 0;
  const viewGueltig = (name: string | null): name is string =>
    name != null && config.online_styles.some((s) => s.name === name);

  const modusGueltig = (m: BasemapModus): boolean =>
    m === 'blind' ||
    (m === 'online' && hatOnline) ||
    (m === 'offline' && config.offline_verfuegbar);

  const modus =
    gespeichert && modusGueltig(gespeichert.modus)
      ? gespeichert.modus
      : einsatzDefault && modusGueltig(einsatzDefault)
        ? einsatzDefault
        : defaultModus(config);

  const onlineView = viewGueltig(gespeichert?.onlineView ?? null)
    ? gespeichert!.onlineView
    : hatOnline
      ? config.online_styles[0].name
      : null;

  const kartenTheme = kartenThemeGueltig(gespeichert?.kartenTheme)
    ? gespeichert.kartenTheme
    : 'auto';

  return { modus, onlineView, kartenTheme };
}
