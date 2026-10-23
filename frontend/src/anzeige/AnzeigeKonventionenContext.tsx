/**
 * Einsatzweiter Context für Anzeige-Konventionen. Der Provider lädt die Einsatz-Einstellungen
 * über den geteilten Query-Key (kein zweiter Abruf neben Settings-Seite und Layout) und stellt
 * an die Konventionen gebundene Formatter bereit. Ohne Provider liefert der Hook die Defaults.
 */
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ladeEinstellungen } from '../api/einsaetze';
import { ladeOrgEinstellungen } from '../api/orgEinstellungen';
import { einsatzKeys, globalKeys } from '../api/queryKeys';
import { useKoordinatenSystemOverride } from './koordinatenSystemStore';
import { useZeitdarstellungGeraet } from './zeitDarstellungStore';
import { useDruckModus } from '../components/druck/useDruckModus';
import { uhrzeit, wirksameZeitdarstellung, zeitKurz, zeitpunkt } from './zeitDarstellung';
import {
  DEFAULT_KONVENTIONEN,
  effektivesKoordinatenformat,
  formatKoordinate,
  formatZeit,
  formatZeitKurz,
  formatDistanz,
  type AnzeigeKonventionen,
} from './format';

interface AnzeigeKonventionenHook {
  konventionen: AnzeigeKonventionen;
  /** Die drei Rollen aus `zeitDarstellung.ts`, an Zone und wirksame Darstellung gebunden. */
  zeitpunkt: (utcStr?: string | null) => string;
  zeitKurz: (utcStr?: string | null) => string;
  uhrzeit: (utcStr?: string | null) => string;
  /** @deprecated `zeitpunkt` (LLH-1053). */
  formatZeit: (utcStr?: string | null) => string;
  /** @deprecated `zeitKurz` (LLH-1053). */
  formatZeitKurz: (utcStr?: string | null) => string;
  formatKoordinate: (lat: number, lon: number) => string;
  formatDistanz: (meter: number) => string;
}

/** Konventionen → gebundene Formatter (memoisiert je Konventions-Objekt). */
function bindeFormatter(konventionen: AnzeigeKonventionen): AnzeigeKonventionenHook {
  return {
    konventionen,
    zeitpunkt: (s) => zeitpunkt(s, konventionen),
    zeitKurz: (s) => zeitKurz(s, konventionen),
    uhrzeit: (s) => uhrzeit(s, konventionen),
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

/**
 * Stellt fertige Konventionen bereit — Baustein der Einsatz-/Org-Provider und direkter Weg für
 * Tests, die keine Einstellungen laden wollen.
 */
export function AnzeigeKonventionenProvider({
  konventionen,
  children,
}: {
  konventionen: AnzeigeKonventionen;
  children: ReactNode;
}) {
  const wert = useMemo(
    () => bindeFormatter({ ...DEFAULT_KONVENTIONEN, ...konventionen }),
    [konventionen],
  );
  return (
    <AnzeigeKonventionenContext.Provider value={wert}>
      {children}
    </AnzeigeKonventionenContext.Provider>
  );
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
  // Zeitdarstellung: Gerät vor Einsatz vor Organisation; im Druck nie das Gerät (LLH-1053, E4).
  // `useDruckModus` rendert per `flushSync` vor dem Einfrieren des Druckbilds.
  const zeitGeraet = useZeitdarstellungGeraet();
  const druckt = useDruckModus();
  // Umgebender Provider (z. B. `OrgAnzeigeProvider` über der Archivakte): greift, wenn die
  // Einsatz-Einstellungen nicht lesbar sind (LFH-692, Spec `zeiteingabe`, „Zone außerhalb eines
  // Einsatzes“). Ohne umgebenden Provider sind das die Defaults — Alt-Verhalten.
  const aussen = useContext(AnzeigeKonventionenContext).konventionen;

  const wert = useMemo<AnzeigeKonventionenHook>(() => {
    // Effektivwert je Konvention: Einsatz-Override vor Org-Default vor Fallback (null) — wie der
    // Backend-Resolver `effektive_*`.
    const konventionen: AnzeigeKonventionen = {
      zeitzone: data?.zeitzone ?? data?.org_defaults?.zeitzone ?? aussen.zeitzone ?? null,
      zeitdarstellung: wirksameZeitdarstellung({
        geraet: zeitGeraet,
        einsatz: data?.zeitdarstellung,
        // Der umgebende Provider rechnet selbst schon Gerät und Druck ein.
        org: data?.org_defaults?.zeitdarstellung ?? aussen.zeitdarstellung,
        druck: druckt,
      }),
      einheiten: data?.einheiten ?? data?.org_defaults?.einheiten ?? aussen.einheiten ?? null,
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
    data?.zeitdarstellung,
    data?.einheiten,
    data?.koordinatenformat,
    data?.org_defaults?.zeitzone,
    data?.org_defaults?.zeitdarstellung,
    data?.org_defaults?.einheiten,
    data?.org_defaults?.koordinatenformat,
    aussen.zeitzone,
    aussen.zeitdarstellung,
    aussen.einheiten,
    override,
    zeitGeraet,
    druckt,
  ]);

  return (
    <AnzeigeKonventionenContext.Provider value={wert}>
      {children}
    </AnzeigeKonventionenContext.Provider>
  );
}

/**
 * Konventionen der Organisation für Seiten außerhalb eines Einsatzes („Einsatz anlegen“,
 * Archivakte; LFH-692, Spec `zeiteingabe`). Der Endpunkt erlaubt nur Admin und Führungskraft —
 * genau die Rollen dieser Seiten. Für alle anderen (403) oder bei einem Fehler bleiben die
 * Defaults, also die Browserzone.
 */
export function OrgAnzeigeProvider({ children }: { children: ReactNode }) {
  const { data } = useQuery({
    queryKey: globalKeys.orgEinstellungen(),
    queryFn: ladeOrgEinstellungen,
    retry: false,
  });
  const override = useKoordinatenSystemOverride();
  const zeitGeraet = useZeitdarstellungGeraet();
  const druckt = useDruckModus();

  const wert = useMemo<AnzeigeKonventionenHook>(
    () =>
      bindeFormatter({
        zeitzone: data?.zeitzone ?? null,
        zeitdarstellung: wirksameZeitdarstellung({
          geraet: zeitGeraet,
          org: data?.zeitdarstellung,
          druck: druckt,
        }),
        einheiten: data?.einheiten ?? null,
        koordinatenformat: effektivesKoordinatenformat(override, null, data?.koordinatenformat),
      }),
    [
      data?.zeitzone,
      data?.zeitdarstellung,
      data?.einheiten,
      data?.koordinatenformat,
      override,
      zeitGeraet,
      druckt,
    ],
  );

  return (
    <AnzeigeKonventionenContext.Provider value={wert}>
      {children}
    </AnzeigeKonventionenContext.Provider>
  );
}
