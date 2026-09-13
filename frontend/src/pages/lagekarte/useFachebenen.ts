import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { keepPreviousData, useQueries } from '@tanstack/react-query';
import {
  ladeFachebene,
  type FachebeneQuelle,
  type FachebeneStatus,
  type FeatureCollection,
} from '../../api/fachebenen';
import { FACHEBENEN, fachebeneKeys, KRITIS_MIN_ZOOM, mergeFeatures } from './fachebenen';
import type { FachebenenSichtbar } from './fachebenenAuswahl';
import type { AktiveFachebene } from './kartenLayer';
import { globalKeys } from '../../api/queryKeys';

/** KRITIS-Sammlung: Obergrenze gegen unbegrenztes Wachstum (älteste zuerst raus). */
const KRITIS_MAX = 4000;

interface FachebenenArgs {
  /** Sichtbarkeit + Setter kommen aus useKartenAnsicht (geteilte Ansicht = Wahrheit). */
  fachebenenSichtbar: FachebenenSichtbar;
  setFachebenenSichtbar: Dispatch<SetStateAction<FachebenenSichtbar>>;
}

/**
 * Fachebenen-Leg der Lagekarte: die vier externen Daten-Queries und ihre Ableitungen.
 * Die Sichtbarkeit hält seit LFH-319 `useKartenAnsicht` (geteilte Ansicht) — dieser Hook
 * bekommt sie als Prop und bietet nur den Toggle; kein eigener State/keine Persistenz.
 *
 * Die vier Queries laufen als EIN `useQueries` mit `combine`: react-query memoisiert das
 * kombinierte Ergebnis (structural sharing via replaceEqualDeep), sodass die Ableitungen
 * (aktiveFachebenen/status/laedt/attribution) OHNE manuelle Dep-Listen und OHNE
 * `eslint-disable react-hooks/exhaustive-deps` stabil bleiben — das inline gebaute,
 * pro Render instabile `fachebenenQueries`-Record (und die vier Disables) entfällt damit.
 */
export function useFachebenen({ fachebenenSichtbar, setFachebenenSichtbar }: FachebenenArgs) {
  const [kritisBbox, setKritisBbox] = useState<string | null>(null);
  // Aktuelles Karten-Zoom-Level — steuert den „näher heranzoomen"-Hinweis für KRITIS.
  const [kartenZoom, setKartenZoom] = useState<number | null>(null);

  // KRITIS akkumulieren: einmal geladene Objekte bleiben sichtbar (auch beim Rauszoomen oder
  // Wechsel des Gebiets), statt bei jedem Fetch ersetzt zu werden. Dedup über die Koordinate.
  const kritisSammlungRef = useRef<Map<string, FeatureCollection['features'][number]>>(new Map());
  const [kritisAkku, setKritisAkku] = useState<FeatureCollection>({
    type: 'FeatureCollection',
    features: [],
  });

  // Vier Fachebenen-Queries als EIN useQueries + combine. Reihenfolge = fachebeneKeys()
  // (nina, dwd, pegelonline, kritis). KRITIS trägt seine Sonderoptionen (dynamischer bbox-Key,
  // keepPreviousData, 6-h-staleTime/gcTime) im eigenen Config-Eintrag; kein refetchInterval.
  const kombiniert = useQueries({
    queries: [
      {
        queryKey: globalKeys.fachebene('nina'),
        queryFn: () => ladeFachebene('nina'),
        enabled: fachebenenSichtbar.nina,
        refetchInterval: FACHEBENEN.nina.pollMs,
      },
      {
        queryKey: globalKeys.fachebene('dwd'),
        queryFn: () => ladeFachebene('dwd'),
        enabled: fachebenenSichtbar.dwd,
        refetchInterval: FACHEBENEN.dwd.pollMs,
      },
      {
        queryKey: globalKeys.fachebene('pegelonline'),
        queryFn: () => ladeFachebene('pegelonline'),
        enabled: fachebenenSichtbar.pegelonline,
        refetchInterval: FACHEBENEN.pegelonline.pollMs,
      },
      {
        queryKey: globalKeys.fachebeneKritis(kritisBbox),
        queryFn: () => ladeFachebene('kritis', kritisBbox!),
        enabled: fachebenenSichtbar.kritis && !!kritisBbox,
        // Beim Wechsel der Raster-bbox die bisherigen KRITIS-Objekte sichtbar lassen (kein
        // Leer-Blinken). KRITIS ist quasi statisch → lange als frisch behandeln (6 h);
        // serverseitig wird ohnehin 1 Tag gecacht.
        placeholderData: keepPreviousData,
        staleTime: 6 * 60 * 60_000,
        gcTime: 6 * 60 * 60_000,
      },
    ],
    // combine wird von react-query memoisiert + strukturell geteilt → stabile Ableitungen.
    combine: (ergebnisse) => {
      const byKey = {
        nina: ergebnisse[0],
        dwd: ergebnisse[1],
        pegelonline: ergebnisse[2],
        kritis: ergebnisse[3],
      } as const;
      const leereFc: FeatureCollection = { type: 'FeatureCollection', features: [] };
      const aktiveFachebenen: AktiveFachebene[] = fachebeneKeys()
        .filter((k) => fachebenenSichtbar[k])
        .map((k) => {
          // KRITIS aus der akkumulierten Sammlung; übrige Quellen direkt aus der Query.
          const daten = k === 'kritis' ? kritisAkku : (byKey[k].data?.features ?? leereFc);
          return { def: FACHEBENEN[k], daten };
        });

      const fachebenenStatus: Partial<Record<FachebeneQuelle, FachebeneStatus>> = {};
      const fachebenenLaedt: Partial<Record<FachebeneQuelle, boolean>> = {};
      for (const k of fachebeneKeys()) {
        if (!fachebenenSichtbar[k]) continue;
        const q = byKey[k];
        fachebenenStatus[k] = q.isError ? 'offline' : q.data?.status;
        fachebenenLaedt[k] = q.isFetching;
      }

      const fachebenenAttribution = fachebeneKeys()
        .filter(
          (k) => fachebenenSichtbar[k] && byKey[k].data && byKey[k].data!.status !== 'offline',
        )
        .map((k) => byKey[k].data!.attribution)
        .filter(Boolean);

      return {
        aktiveFachebenen,
        fachebenenStatus,
        fachebenenLaedt,
        fachebenenAttribution,
        // Rohdaten für die KRITIS-Akkumulation (der Akku selbst geht via kritisAkku ein).
        kritisRoh: byKey.kritis.data,
      };
    },
  });

  useEffect(() => {
    const fc = kombiniert.kritisRoh?.features;
    if (!fc) return;
    if (mergeFeatures(kritisSammlungRef.current, fc.features, KRITIS_MAX)) {
      setKritisAkku({
        type: 'FeatureCollection',
        features: [...kritisSammlungRef.current.values()],
      });
    }
  }, [kombiniert.kritisRoh]);

  const kritisZoomZuKlein =
    fachebenenSichtbar.kritis && kartenZoom != null && kartenZoom < KRITIS_MIN_ZOOM;

  const onFachebeneToggle = (k: FachebeneQuelle, an: boolean) =>
    setFachebenenSichtbar((s) => ({ ...s, [k]: an }));

  return {
    fachebenenSichtbar,
    onFachebeneToggle,
    aktiveFachebenen: kombiniert.aktiveFachebenen,
    fachebenenStatus: kombiniert.fachebenenStatus,
    fachebenenLaedt: kombiniert.fachebenenLaedt,
    fachebenenAttribution: kombiniert.fachebenenAttribution,
    kritisZoomZuKlein,
    setKritisBbox,
    setKartenZoom,
  };
}
