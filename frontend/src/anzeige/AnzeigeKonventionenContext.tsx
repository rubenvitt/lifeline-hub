/**
 * Einsatzweiter Context für Anzeige-Konventionen. Der Provider lädt die Einsatz-Einstellungen
 * über den geteilten Query-Key (kein zweiter Abruf neben Settings-Seite und Layout) und stellt
 * an die Konventionen gebundene Formatter bereit. Ohne Provider liefert der Hook die Defaults.
 */
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ladeEinstellungen } from '../api/einsaetze';
import { einsatzKeys } from '../api/queryKeys';
import { useKoordinatenSystemOverride } from './koordinatenSystemStore';
import {
  DEFAULT_KONVENTIONEN,
  effektivesKoordinatenformat,
  formatKoordinate,
  formatZeit,
  formatZeitKurz,
  formatDistanz,
  type AnzeigeKonventionen,
} from './format';

export interface AnzeigeKonventionenHook {
  konventionen: AnzeigeKonventionen;
  formatZeit: (utcStr?: string | null) => string;
  formatZeitKurz: (utcStr?: string | null) => string;
  formatKoordinate: (lat: number, lon: number) => string;
  formatDistanz: (meter: number) => string;
}

/** Konventionen → gebundene Formatter (memoisiert je Konventions-Objekt). */
function bindeFormatter(konventionen: AnzeigeKonventionen): AnzeigeKonventionenHook {
  return {
    konventionen,
    formatZeit: (s) => formatZeit(s, konventionen),
    formatZeitKurz: (s) => formatZeitKurz(s, konventionen),
    formatKoordinate: (lat, lon) => formatKoordinate(lat, lon, konventionen),
    formatDistanz: (m) => formatDistanz(m, konventionen),
  };
}

const AnzeigeKonventionenContext = createContext<AnzeigeKonventionenHook>(
  bindeFormatter(DEFAULT_KONVENTIONEN),
);

/** Liefert die an den Einsatz gebundenen Formatter + rohe Konventionen. */
export function useAnzeigeKonventionen(): AnzeigeKonventionenHook {
  return useContext(AnzeigeKonventionenContext);
}

export function EinsatzAnzeigeProvider({
  einsatzId,
  children,
}: {
  einsatzId: number;
  children: ReactNode;
}) {
  const { data } = useQuery({
    queryKey: einsatzKeys.einstellungen(einsatzId),
    queryFn: () => ladeEinstellungen(einsatzId),
  });

  const override = useKoordinatenSystemOverride();

  const wert = useMemo<AnzeigeKonventionenHook>(() => {
    // Effektivwert je Konvention: Einsatz-Override vor Org-Default vor Fallback (null) — wie der
    // Backend-Resolver `effektive_*`.
    const konventionen: AnzeigeKonventionen = {
      zeitzone: data?.zeitzone ?? data?.org_defaults?.zeitzone ?? null,
      zeitformat: data?.zeitformat ?? data?.org_defaults?.zeitformat ?? null,
      einheiten: data?.einheiten ?? data?.org_defaults?.einheiten ?? null,
      // Der app-weite Anwender-Override (localStorage) sticht zusätzlich alles.
      koordinatenformat: effektivesKoordinatenformat(
        override,
        data?.koordinatenformat,
        data?.org_defaults?.koordinatenformat,
      ),
    };
    return bindeFormatter(konventionen);
  }, [
    data?.zeitzone,
    data?.zeitformat,
    data?.einheiten,
    data?.koordinatenformat,
    data?.org_defaults?.zeitzone,
    data?.org_defaults?.zeitformat,
    data?.org_defaults?.einheiten,
    data?.org_defaults?.koordinatenformat,
    override,
  ]);

  return (
    <AnzeigeKonventionenContext.Provider value={wert}>
      {children}
    </AnzeigeKonventionenContext.Provider>
  );
}
