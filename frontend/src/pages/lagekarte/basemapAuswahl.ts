import type { KarteServerConfig } from '../../api/karte';
import { defaultModus, type BasemapModus } from './basemapStil';

/** Pro Einsatz gemerkte Kartenwahl (Modus + Online-View). */
export interface GespeicherteBasemap {
  modus: BasemapModus;
  /** Name des Online-Views; nur für `modus === 'online'` relevant, sonst null. */
  onlineView: string | null;
}

/**
 * Wählt die initiale Kartenwahl für den Einstieg in die Lagekarte.
 * Priorität: gemerkte Wahl, sofern mit der aktuellen Server-Config noch gültig —
 * sonst der Verfügbarkeits-Default (online → offline → blind).
 *
 * Gültigkeitsprüfung gegen die Config, weil sich Verfügbarkeit/Views serverseitig
 * geändert haben können (z. B. Offline gemerkt, aber pmtiles nicht mehr verfügbar;
 * Online-View gemerkt, aber umbenannt/entfernt).
 */
export function waehleInitialeBasemap(
  config: KarteServerConfig,
  gespeichert: GespeicherteBasemap | null,
): GespeicherteBasemap {
  const hatOnline = config.online_styles.length > 0;
  const viewGueltig = (name: string | null): name is string =>
    name != null && config.online_styles.some((s) => s.name === name);

  const modusGueltig = (m: BasemapModus): boolean =>
    m === 'blind' || (m === 'online' && hatOnline) || (m === 'offline' && config.pmtiles_verfuegbar);

  const modus = gespeichert && modusGueltig(gespeichert.modus) ? gespeichert.modus : defaultModus(config);

  const onlineView = viewGueltig(gespeichert?.onlineView ?? null)
    ? gespeichert!.onlineView
    : hatOnline
      ? config.online_styles[0].name
      : null;

  return { modus, onlineView };
}

const schluessel = (einsatzId: number) => `basemap:letzteAuswahl:${einsatzId}`;

/** Merkt die zuletzt gewählte Karte pro Einsatz (überlebt Reload). */
export function merkeLetzteBasemap(einsatzId: number, wahl: GespeicherteBasemap): void {
  try {
    localStorage.setItem(schluessel(einsatzId), JSON.stringify(wahl));
  } catch {
    /* localStorage nicht verfügbar — ohne Persistenz weiterarbeiten */
  }
}

/** Liest die zuletzt gewählte Karte eines Einsatzes, oder null. */
export function liesLetzteBasemap(einsatzId: number): GespeicherteBasemap | null {
  try {
    const roh = localStorage.getItem(schluessel(einsatzId));
    if (!roh) return null;
    const wert = JSON.parse(roh) as Partial<GespeicherteBasemap>;
    if (wert.modus !== 'online' && wert.modus !== 'offline' && wert.modus !== 'blind') return null;
    return { modus: wert.modus, onlineView: typeof wert.onlineView === 'string' ? wert.onlineView : null };
  } catch {
    return null;
  }
}
