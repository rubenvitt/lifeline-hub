/**
 * Einsatzweiter Context für Anzeige-Konventionen (LFH-136). Der Provider lädt die
 * Einsatz-Einstellungen über den GETEILTEN queryKey `['einsatz-einstellungen', id]`
 * (React-Query dedupliziert/teilt den Cache mit Settings-Seite & Layout — keine
 * zweite Query) und stellt an die Konventionen gebundene Formatter bereit.
 *
 * Ohne Provider liefert der Hook bewusst die Defaults (kein Throw) → jede
 * Out-of-Provider-Anzeige bleibt byte-identisch zum Alt-Verhalten.
 */
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ladeEinstellungen } from '../api/einsaetze';
import { einsatzKeys } from '../api/queryKeys';
import { useKoordinatenSystemOverride } from './koordinatenSystemStore';
import {
  DEFAULT_KONVENTIONEN,
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
  // Geteilter queryKey mit Settings-Seite/Layout — keine zweite Query.
  const { data } = useQuery({
    queryKey: einsatzKeys.einstellungen(einsatzId),
    queryFn: () => ladeEinstellungen(einsatzId),
  });

  const override = useKoordinatenSystemOverride();

  const wert = useMemo<AnzeigeKonventionenHook>(() => {
    // Effektivwert je Konvention: Einsatz-Override sticht den globalen Org-Default, dieser
    // den hartkodierten Fallback (null). Spiegelt den Backend-Resolver `effektive_*`, damit
    // ein org-weit gesetzter Default auch ohne Einsatz-Override in der Anzeige greift.
    const konventionen: AnzeigeKonventionen = {
      zeitzone: data?.zeitzone ?? data?.org_defaults?.zeitzone ?? null,
      zeitformat: data?.zeitformat ?? data?.org_defaults?.zeitformat ?? null,
      einheiten: data?.einheiten ?? data?.org_defaults?.einheiten ?? null,
      // Der app-weite Anwender-Override (localStorage) sticht zusätzlich alles.
      koordinatenformat:
        override ?? data?.koordinatenformat ?? data?.org_defaults?.koordinatenformat ?? null,
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
