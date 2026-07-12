import { useEffect, useMemo, useRef, useState } from 'react';
import type { KarteServerConfig } from '../../api/karte';
import type { EinsatzEinstellungen } from '../../api/types';
import {
  baueBasemapStyle, aktuelleAttribution, loeseKartenTheme,
  type BasemapModus, type KartenTheme, type KartenThemeWahl,
} from './basemapStil';
import { waehleInitialeBasemap, liesLetzteBasemap, merkeLetzteBasemap } from './basemapAuswahl';

interface BasemapArgs {
  einsatzId: number;
  config: KarteServerConfig | undefined;
  einstellungen: EinsatzEinstellungen | undefined;
  einstellungenLaedt: boolean;
  /** Effektives App-Theme ('light'/'dark') zur Auflösung der 'auto'-Kartenwahl. */
  effektiv: KartenTheme;
}

/**
 * Basemap-Leg der Lagekarte: Modus/Online-View/Karten-Theme-State inkl. pro-Einsatz-
 * Persistenz (localStorage), plus die abgeleiteten MapLibre-Style- und Attributions-Bausteine.
 * Die Fachebenen-Attribution wird bewusst NICHT hier gemergt (Grenze zu useFachebenen) —
 * die Page komponiert `basisAttribution` mit `fachebenenAttribution`.
 */
export function useBasemap({ einsatzId, config, einstellungen, einstellungenLaedt, effektiv }: BasemapArgs) {
  const [basemap, setBasemap] = useState<BasemapModus | null>(null);
  const [onlineStilName, setOnlineStilName] = useState<string | null>(null);
  // Karten-lokale Theme-Wahl (LFH-197): 'auto' folgt dem App-Theme, 'light'/'dark' überschreiben.
  const [kartenTheme, setKartenTheme] = useState<KartenThemeWahl>('auto');

  // Kartenwahl einmal aus der pro-Einsatz gemerkten Auswahl (localStorage) initialisieren,
  // gegen die aktuelle Config validiert; sonst Verfügbarkeits-Default. Danach persistiert
  // ein Effekt jede Änderung.
  const basemapInitiiertRef = useRef(false);
  useEffect(() => {
    if (basemapInitiiertRef.current || !config || einstellungenLaedt) return;
    basemapInitiiertRef.current = true;
    const { modus, onlineView, kartenTheme: gemerktesTheme } = waehleInitialeBasemap(
      config,
      liesLetzteBasemap(einsatzId),
      einstellungen?.basemap_modus ?? null,
    );
    setBasemap(modus);
    setOnlineStilName(onlineView);
    setKartenTheme(gemerktesTheme);
  }, [config, einsatzId, einstellungenLaedt, einstellungen]);

  // Jede Änderung der Kartenwahl pro Einsatz merken (erst nach der Initialisierung,
  // damit der gemerkte Wert nicht durch den transienten Default überschrieben wird).
  useEffect(() => {
    if (!basemapInitiiertRef.current || basemap == null) return;
    merkeLetzteBasemap(einsatzId, { modus: basemap, onlineView: onlineStilName, kartenTheme });
  }, [basemap, onlineStilName, kartenTheme, einsatzId]);

  const onlineStil = useMemo(() => {
    const liste = config?.online_styles ?? [];
    return liste.find((s) => s.name === onlineStilName) ?? liste[0];
  }, [config, onlineStilName]);

  // Karten-lokale Wahl gegen das App-Theme auflösen ('auto' → App-Theme).
  const kartenThemeEffektiv = loeseKartenTheme(kartenTheme, effektiv);
  const style = useMemo(
    () => baueBasemapStyle(basemap ?? 'blind', kartenThemeEffektiv, config, onlineStil),
    [basemap, kartenThemeEffektiv, config, onlineStil],
  );

  // Basisbaustein der Attribution (ohne Fachebenen) — die Page mergt ihn mit fachebenenAttribution.
  const basisAttribution = useMemo(
    () => aktuelleAttribution(basemap ?? 'blind', onlineStil, config),
    [basemap, onlineStil, config],
  );

  // Style-Ladefehler → auf die nächst-robustere Basemap zurückfallen (online→offline→blind).
  const onStyleFehler = () =>
    setBasemap((m) => (m === 'online' ? 'offline' : m === 'offline' ? 'blind' : 'blind'));

  return {
    basemap,
    setBasemap,
    onlineStilName,
    setOnlineStilName,
    kartenTheme,
    setKartenTheme,
    onlineStil,
    style,
    basisAttribution,
    onStyleFehler,
  };
}
