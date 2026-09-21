import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { theme } from 'antd';
import { keepPreviousData, useQueries, useQuery } from '@tanstack/react-query';
import {
  ladeFachebene,
  type FachebeneQuelle,
  type FachebeneStatus,
  type FeatureCollection,
} from '../../api/fachebenen';
import {
  BBOX_MIN_ZOOM,
  FACHEBENEN,
  fachebeneKeys,
  fachebeneTakt,
  istBboxAbhaengig,
  mergeFeatures,
} from './fachebenen';
import type { FachebenenSichtbar } from './fachebenenAuswahl';
import { faerbeHochwasser } from './hochwasserStil';
import { faerbeLuftqualitaet } from './luftqualitaetStil';
import { faerbeOdl } from './odlStil';
import type { AktiveFachebene } from './kartenLayer';
import { globalKeys } from '../../api/queryKeys';

type Feature = FeatureCollection['features'][number];

/** Obergrenze der Energie-Sammlung gegen unbegrenztes Wachstum (älteste zuerst raus). Der
 *  Rauschfilter lässt nur Großanlagen durch (design.md, Entscheidung 6), 2000 reicht weit. */
const ENERGIE_AKKU_MAX = 2000;

const leereFc = (): FeatureCollection => ({ type: 'FeatureCollection', features: [] });

interface FachebenenArgs {
  /** Sichtbarkeit + Setter kommen aus useKartenAnsicht (geteilte Ansicht = Wahrheit). */
  fachebenenSichtbar: FachebenenSichtbar;
  setFachebenenSichtbar: Dispatch<SetStateAction<FachebenenSichtbar>>;
}

/**
 * Fachebenen-Leg der Lagekarte: die externen Daten-Queries (eine je Fachebene) und ihre Ableitungen.
 * Die Sichtbarkeit hält seit LFH-319 `useKartenAnsicht` (geteilte Ansicht) — dieser Hook
 * bekommt sie als Prop und bietet nur den Toggle; kein eigener State/keine Persistenz.
 *
 * Die Queries mit festem Schlüssel laufen als EIN `useQueries` mit `combine`: react-query memoisiert das
 * kombinierte Ergebnis (structural sharing via replaceEqualDeep), sodass die Ableitungen
 * (aktiveFachebenen/status/laedt/attribution) OHNE manuelle Dep-Listen und OHNE
 * `eslint-disable react-hooks/exhaustive-deps` stabil bleiben — das inline gebaute,
 * pro Render instabile `fachebenenQueries`-Record (und die vier Disables) entfällt damit.
 *
 * KRITIS und Energie laufen daneben je als eigenes `useQuery` (LFH-83, LFH-81): ihr Schlüssel
 * wandert mit der bbox, und `useQueries` legt je neuem Schlüssel einen NEUEN Observer an
 * (`QueriesObserver#findMatchingObservers` matcht per `queryHash`) — `keepPreviousData`
 * hat dort nichts, woran es festhalten könnte, und die Ebene blinkte bei jedem Pannen leer.
 * Gemessen am Test „hält beim bbox-Wechsel die bisherigen KRITIS-Daten"; vorher verdeckte
 * die Akkumulation diese Lücke. `combine` liest das Ergebnis über die Closure.
 */
export function useFachebenen({ fachebenenSichtbar, setFachebenenSichtbar }: FachebenenArgs) {
  // Hochwasser-, ODL- und Luftqualitätsebene färben je Punkt nach ihrer Stufe und brauchen den aufgelösten
  // Modus-Token — die Kartenstil-Module haben den bewusst nicht (LFH-328/A2), also wird er
  // hier gelesen und in die Features gebacken.
  const { token } = theme.useToken();
  // EIN Ausschnitt für alle bbox-abhängigen Ebenen (LFH-81): die Karte hat nur einen
  // Viewport, zwei getrennte States könnten nur auseinanderlaufen.
  const [viewportBbox, setViewportBbox] = useState<string | null>(null);
  // Zuletzt gesehener Status der Autobahn-Ebene — steuert ihren Poll-Takt (Aufwärmphase).
  const [autobahnStatus, setAutobahnStatus] = useState<FachebeneStatus | undefined>(undefined);
  // Aktuelles Karten-Zoom-Level — steuert den „näher heranzoomen"-Hinweis der bbox-Ebenen.
  const [kartenZoom, setKartenZoom] = useState<number | null>(null);

  // Energie akkumuliert: einmal geladene Anlagen bleiben sichtbar (auch beim Rauszoomen oder
  // Wechsel des Gebiets), statt bei jedem Fetch ersetzt zu werden — anders als KRITIS liefert
  // ihr bbox-Fetch nur den Ausschnitt, keinen vollständigen Bestand (s. o.). Dedup über die
  // Koordinate.
  const energieSammlungRef = useRef(new Map<string, Feature>());
  const [energieAkku, setEnergieAkku] = useState<FeatureCollection>(leereFc());

  const kritis = useQuery({
    queryKey: globalKeys.fachebeneKritis(viewportBbox),
    queryFn: () => ladeFachebene('kritis', viewportBbox!),
    enabled: fachebenenSichtbar.kritis && !!viewportBbox,
    // Beim Wechsel der Raster-bbox die bisherigen KRITIS-Objekte sichtbar lassen (kein
    // Leer-Blinken). Die Antwort ERSETZT das Bild (LFH-83) — der Server liefert je
    // Ausschnitt den vollständigen Bestand oder dessen Sammelpunkte; akkumuliert lägen
    // Einzelobjekte und Sammelpunkte derselben Gegend übereinander. Der Bestand wird
    // wöchentlich erneuert → lange als frisch behandeln (6 h).
    placeholderData: keepPreviousData,
    staleTime: 6 * 60 * 60_000,
    gcTime: 6 * 60 * 60_000,
    // Mit Bestand 0 (kein Timer), in der Aufwärmphase des ersten Imports der kurze Takt —
    // sonst erschiene der Bestand erst beim nächsten Pannen. Hier geht die Callback-Form:
    // die Typinferenz-Falle (siehe `autobahn` unten) betrifft nur das `useQueries`-Tupel.
    // `error` zählt als offline, weil react-query nach einem gescheiterten Abruf die
    // vorigen `data` hält.
    refetchInterval: (q) =>
      fachebeneTakt('kritis', q.state.status === 'error' ? 'offline' : q.state.data?.status),
  });

  const energie = useQuery({
    queryKey: globalKeys.fachebeneEnergie(viewportBbox),
    queryFn: () => ladeFachebene('energie', viewportBbox!),
    enabled: fachebenenSichtbar.energie && !!viewportBbox,
    // Anders als KRITIS liefert der Energie-Fetch nur den Ausschnitt (OSM live je bbox,
    // MaStR bundesweit gecacht) — client-seitige Akkumulation (`energieAkku` unten) hält die
    // schon gesehenen Anlagen sichtbar. Serverseitig 24 h frisch; 6 h hier reichen weit über
    // eine Einsatzschicht.
    placeholderData: keepPreviousData,
    staleTime: 6 * 60 * 60_000,
    gcTime: 6 * 60 * 60_000,
  });

  // Sieben Fachebenen-Queries als EIN useQueries + combine. Reihenfolge: nina, dwd,
  // pegelonline, hochwasser, odl, autobahn, luftqualitaet — fachebeneKeys() ohne kritis und
  // energie (beide oben als eigenes useQuery, s. o.), und NICHT in Panel-Reihenfolge. `byKey`
  // unten hängt an DIESER Reihenfolge und greift sie positionsweise ab; ein verschobener
  // Index ist kein Fehler, sondern eine stille Verwechslung.
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
        queryKey: globalKeys.fachebene('hochwasser'),
        queryFn: () => ladeFachebene('hochwasser'),
        enabled: fachebenenSichtbar.hochwasser,
        refetchInterval: FACHEBENEN.hochwasser.pollMs,
      },
      {
        queryKey: globalKeys.fachebene('odl'),
        queryFn: () => ladeFachebene('odl'),
        enabled: fachebenenSichtbar.odl,
        refetchInterval: FACHEBENEN.odl.pollMs,
      },
      {
        queryKey: globalKeys.fachebene('autobahn'),
        queryFn: () => ladeFachebene('autobahn'),
        enabled: fachebenenSichtbar.autobahn,
        // Takt hängt am zuletzt gesehenen Status: der erste Lauf der Ebene hängt
        // serverseitig an keinem Request (er dauert ~25 s und liefe sonst in die
        // 15-s-Schranke von `apiGet`). Bis er durch ist, meldet die Ebene `offline` — mit
        // dem regulären 600-s-Takt sähe der Bediener zehn Minuten lang nichts, obwohl die
        // Daten nach ~30 s bereitstehen.
        //
        // Bewusst über einen State statt über die Callback-Form von `refetchInterval`: die
        // Callback-Form lässt die Typinferenz dieses `useQueries`-Tupels kollabieren (alle
        // Einträge werden zu `UseQueryResult<unknown>`, und `combine` verliert seine
        // Typen). Gemessen, nicht vermutet — der Versuch steht im Verlauf dieses Tickets.
        refetchInterval: fachebeneTakt('autobahn', autobahnStatus),
      },
      // LETZTER Eintrag, bewusst am ENDE (LFH-79): `byKey` greift positionsweise ab, eine
      // Query mitten im Tupel verschöbe die Nachbarn still auf fremde Daten.
      {
        queryKey: globalKeys.fachebene('luftqualitaet'),
        queryFn: () => ladeFachebene('luftqualitaet'),
        enabled: fachebenenSichtbar.luftqualitaet,
        refetchInterval: FACHEBENEN.luftqualitaet.pollMs,
      },
    ],
    // combine wird von react-query memoisiert + strukturell geteilt → stabile Ableitungen.
    combine: (ergebnisse) => {
      const byKey = {
        nina: ergebnisse[0],
        dwd: ergebnisse[1],
        pegelonline: ergebnisse[2],
        hochwasser: ergebnisse[3],
        odl: ergebnisse[4],
        kritis,
        energie,
        autobahn: ergebnisse[5],
        luftqualitaet: ergebnisse[6],
      } as const;
      const leerFc: FeatureCollection = { type: 'FeatureCollection', features: [] };
      const aktiveFachebenen: AktiveFachebene[] = fachebeneKeys()
        .filter((k) => fachebenenSichtbar[k])
        .map((k) => {
          // Energie aus ihrer akkumulierten Sammlung (s. o.); Hochwasser, ODL und
          // Luftqualität mit eingebackener Farbe und Punktgröße je Stufe; übrige Quellen
          // (auch KRITIS, LFH-83) direkt aus der Query.
          const roh = byKey[k].data?.features ?? leerFc;
          const daten =
            k === 'energie'
              ? energieAkku
              : k === 'hochwasser'
                ? faerbeHochwasser(roh, token)
                : k === 'odl'
                  ? faerbeOdl(roh, token)
                  : k === 'luftqualitaet'
                    ? faerbeLuftqualitaet(roh, token)
                    : roh;
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
        // Rohdaten für die Energie-Akkumulation (der Akku selbst geht via `energieAkku` ein).
        energieRoh: byKey.energie.data?.features,
        // Status der Autobahn-Ebene für den Aufwärm-Takt (siehe `refetchInterval` oben).
        // `isError` gehört dazu wie in der Statuszeile darüber: react-query HÄLT bei einem
        // gescheiterten Refetch die vorigen `data` — ohne den Zweig meldete die Ableitung
        // weiter `ok`, während die Ebene oben schon `offline` anzeigt, und der Takt bliebe
        // zehn Minuten lang der reguläre statt des Aufwärm-Takts.
        autobahnStatusRoh: byKey.autobahn.isError ? 'offline' : byKey.autobahn.data?.status,
      };
    },
  });

  // Ein neuer Energie-Stand mergt in die Sammlung; veröffentlicht wird nur bei einer echten
  // Änderung (sonst liefe jeder Refetch als neues Objekt durch die Karte).
  useEffect(() => {
    const fc = kombiniert.energieRoh;
    if (!fc) return;
    const sammlung = energieSammlungRef.current;
    if (!mergeFeatures(sammlung, fc.features, ENERGIE_AKKU_MAX)) return;
    setEnergieAkku({ type: 'FeatureCollection', features: [...sammlung.values()] });
  }, [kombiniert.energieRoh]);

  // Setzen mit demselben Wert ist in React ein No-op → keine Renderschleife.
  useEffect(() => {
    setAutobahnStatus(kombiniert.autobahnStatusRoh);
  }, [kombiniert.autobahnStatusRoh]);

  // „Zu weit herausgezoomt" je Quelle (LFH-81): gesetzt nur für sichtbare bbox-Ebenen, die
  // unter dem Mindest-Zoom stehen — die Sidebar liest es für jede bbox-Ebene gleich.
  const zuWeitDraussen = kartenZoom != null && kartenZoom < BBOX_MIN_ZOOM;
  const zoomZuKlein: Partial<Record<FachebeneQuelle, boolean>> = {};
  for (const k of fachebeneKeys()) {
    if (istBboxAbhaengig(k) && fachebenenSichtbar[k]) zoomZuKlein[k] = zuWeitDraussen;
  }

  const onFachebeneToggle = (k: FachebeneQuelle, an: boolean) =>
    setFachebenenSichtbar((s) => ({ ...s, [k]: an }));

  return {
    fachebenenSichtbar,
    onFachebeneToggle,
    aktiveFachebenen: kombiniert.aktiveFachebenen,
    fachebenenStatus: kombiniert.fachebenenStatus,
    fachebenenLaedt: kombiniert.fachebenenLaedt,
    fachebenenAttribution: kombiniert.fachebenenAttribution,
    zoomZuKlein,
    setViewportBbox,
    setKartenZoom,
  };
}
