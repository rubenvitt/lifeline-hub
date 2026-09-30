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
  energieAusschnittPasst,
  energieNennung,
  FACHEBENEN,
  fachebeneKeys,
  fachebeneTakt,
  mergeEnergieFeatures,
  NENNUNG_TRENNER,
} from './fachebenen';
import type { FachebenenSichtbar } from './fachebenenAuswahl';
import { faerbeHochwasser } from './hochwasserStil';
import { faerbeLuftqualitaet } from './luftqualitaetStil';
import { faerbeOdl } from './odlStil';
import type { AktiveFachebene } from './kartenLayer';
import { globalKeys } from '../../api/queryKeys';
import { fachebeneFarbe } from '../../theme/statusFarben';

type Feature = FeatureCollection['features'][number];

/**
 * Obergrenze der Energie-Sammlung (älteste zuerst raus). Der Rauschfilter lässt nur Großanlagen
 * durch, 2000 reicht weit.
 */
const ENERGIE_AKKU_MAX = 2000;

const leereFc = (): FeatureCollection => ({ type: 'FeatureCollection', features: [] });

interface FachebenenArgs {
  /** Sichtbarkeit + Setter kommen aus useKartenAnsicht (geteilte Ansicht = Wahrheit). */
  fachebenenSichtbar: FachebenenSichtbar;
  setFachebenenSichtbar: Dispatch<SetStateAction<FachebenenSichtbar>>;
}

/**
 * Fachebenen-Leg der Lagekarte: die externen Daten-Queries (eine je Fachebene) und ihre
 * Ableitungen. Die Sichtbarkeit hält `useKartenAnsicht` (geteilte Ansicht); dieser Hook bietet
 * nur den Toggle, ohne eigenen State und ohne Persistenz.
 *
 * Die Queries mit festem Schlüssel laufen als ein `useQueries` mit `combine`: react-query
 * memoisiert das Ergebnis (replaceEqualDeep), die Ableitungen bleiben ohne manuelle Dep-Listen
 * stabil.
 *
 * KRITIS und Energie laufen je als eigenes `useQuery`: ihr Schlüssel wandert mit der bbox, und
 * `useQueries` legt je neuem Schlüssel einen neuen Observer an — `keepPreviousData` hätte nichts,
 * woran es festhält, und die Ebene blinkte bei jedem Pannen leer. `combine` liest das Ergebnis
 * über die Closure.
 */
export function useFachebenen({ fachebenenSichtbar, setFachebenenSichtbar }: FachebenenArgs) {
  // Hochwasser, ODL und Luftqualität färben je Punkt nach Stufe und brauchen den aufgelösten
  // Modus-Token; die Kartenstil-Module haben ihn bewusst nicht, also wird er hier in die Features
  // gebacken.
  const { token } = theme.useToken();
  // Ein Ausschnitt für alle bbox-abhängigen Ebenen: die Karte hat nur einen Viewport.
  const [viewportBbox, setViewportBbox] = useState<string | null>(null);
  // Zuletzt gesehener Status der Autobahn-Ebene — steuert ihren Poll-Takt (Aufwärmphase).
  const [autobahnStatus, setAutobahnStatus] = useState<FachebeneStatus | undefined>(undefined);
  // Aktuelles Karten-Zoom-Level — steuert den „näher heranzoomen"-Hinweis der bbox-Ebenen.
  const [kartenZoom, setKartenZoom] = useState<number | null>(null);

  // Energie akkumuliert: einmal geladene Anlagen bleiben sichtbar, weil ihr bbox-Fetch nur den
  // Ausschnitt liefert, keinen vollständigen Bestand. Dedup über die Koordinate, neuere Fassung
  // gewinnt (`mergeEnergieFeatures`).
  const energieSammlungRef = useRef(new Map<string, Feature>());
  const [energieAkku, setEnergieAkku] = useState<FeatureCollection>(leereFc());
  // Energie fragt live Overpass, lehnt große Ausschnitte ab (`pruefe_energie_bbox`) und ist unter
  // dem Mindest-Zoom nicht gemeint. Ohne beide Riegel ginge eine Anfrage raus, die das Backend mit
  // 400 quittiert oder die die Ebene fälschlich auf „offline" zeigt.
  const energieMinZoom = FACHEBENEN.energie.minZoom;
  const energieZoomReicht =
    energieMinZoom === undefined || (kartenZoom !== null && kartenZoom >= energieMinZoom);
  // Ohne Ausschnitt ist „zu groß" keine Aussage; dort entscheidet für den Zoom-Hinweis allein der
  // Zoom.
  const energieBboxZuGross = viewportBbox !== null && !energieAusschnittPasst(viewportBbox);
  const energiePasst = energieZoomReicht && viewportBbox !== null && !energieBboxZuGross;
  // In Energie-Antworten gesehene Nennungsteile. Gezeigt wird, was die gesammelten Punkte tragen
  // (`energieNennung`), nicht die Nennung der letzten Antwort.
  const [energieTeile, setEnergieTeile] = useState<string[]>([]);

  const kritis = useQuery({
    queryKey: globalKeys.fachebeneKritis(viewportBbox),
    queryFn: () => ladeFachebene('kritis', viewportBbox!),
    enabled: fachebenenSichtbar.kritis && !!viewportBbox,
    // Beim bbox-Wechsel die bisherigen KRITIS-Objekte stehen lassen (kein Leer-Blinken). Die
    // Antwort ersetzt das Bild: der Server liefert je Ausschnitt den vollständigen Bestand oder
    // dessen Sammelpunkte, akkumuliert lägen beide übereinander. Der Bestand wird wöchentlich
    // erneuert, daher 6 h frisch.
    placeholderData: keepPreviousData,
    staleTime: 6 * 60 * 60_000,
    gcTime: 6 * 60 * 60_000,
    // Mit Bestand kein Timer, in der Aufwärmphase des ersten Imports der kurze Takt. Die
    // Callback-Form geht hier; die Typinferenz-Falle (siehe `autobahn` unten) betrifft nur das
    // `useQueries`-Tupel. `error` zählt als offline, weil react-query nach einem gescheiterten
    // Abruf die vorigen `data` hält.
    refetchInterval: (q) =>
      fachebeneTakt('kritis', q.state.status === 'error' ? 'offline' : q.state.data?.status),
  });

  const energie = useQuery({
    queryKey: globalKeys.fachebeneEnergie(viewportBbox),
    queryFn: () => ladeFachebene('energie', viewportBbox!),
    // Hält eine Anfrage über einen zu großen Ausschnitt zurück (das Backend antwortete 400).
    enabled: fachebenenSichtbar.energie && !!viewportBbox && energiePasst,
    // Der Energie-Fetch liefert nur den Ausschnitt; `energieAkku` hält Gesehenes sichtbar.
    // `staleTime` bewusst kurz: ein kalter Abruf antwortet nach höchstens 10 s mit dem Teil, der
    // schon da ist, und holt den Rest im Hintergrund (`fetch_energie`). Mit 6 h bliebe diese
    // unvollständige Antwort stehen. Ein erneuter Abruf trifft den Server-Cache.
    placeholderData: keepPreviousData,
    staleTime: 2 * 60_000,
    gcTime: 6 * 60 * 60_000,
  });

  // Sieben Fachebenen-Queries als ein `useQueries` + `combine`, in der Reihenfolge von
  // `fachebeneKeys()` ohne kritis und energie (nicht Panel-Reihenfolge). `byKey` greift
  // positionsweise ab: ein verschobener Index ist eine stille Verwechslung, kein Fehler.
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
        // Takt hängt am zuletzt gesehenen Status: der erste Lauf der Ebene dauert serverseitig ~25
        // s und hängt an keinem Request. Bis dahin meldet sie `offline`; mit dem regulären
        // 600-s-Takt sähe man zehn Minuten nichts.
        //
        // State statt Callback-Form von `refetchInterval`: die Callback-Form lässt die Typinferenz
        // dieses `useQueries`-Tupels kollabieren (alles `UseQueryResult<unknown>`, `combine`
        // verliert seine Typen).
        refetchInterval: fachebeneTakt('autobahn', autobahnStatus),
      },
      // Letzter Eintrag, bewusst am Ende: `byKey` greift positionsweise ab.
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
          // Energie aus ihrer Sammlung; Hochwasser, ODL und Luftqualität mit eingebackener Farbe
          // und Punktgröße; übrige Quellen direkt aus der Query.
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
          return { def: FACHEBENEN[k], daten, farbe: fachebeneFarbe(k, token) };
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
        .map((k) => {
          if (!fachebenenSichtbar[k]) return '';
          // Energie nennt, was gezeichnet wird: die Sammlung kann Punkte aus früheren Ausschnitten
          // tragen. Deshalb auch unabhängig vom Status.
          if (k === 'energie')
            return energieNennung(energieTeile, energieAkku.features).join(NENNUNG_TRENNER);
          const d = byKey[k].data;
          return d && d.status !== 'offline' ? d.attribution : '';
        })
        .filter(Boolean);

      return {
        aktiveFachebenen,
        fachebenenStatus,
        fachebenenLaedt,
        fachebenenAttribution,
        // Rohdaten für die Energie-Akkumulation (der Akku selbst geht via `energieAkku` ein).
        energieRoh: byKey.energie.data?.features,
        // Nennungsteile der aktuellen Energie-Antwort (nur bei online, nie leer); `energieTeile`
        // sammelt daraus.
        energieAttributionRoh:
          byKey.energie.data && byKey.energie.data.status !== 'offline'
            ? byKey.energie.data.attribution
            : undefined,
        // Status für den Aufwärm-Takt. `isError` gehört dazu: react-query hält bei gescheitertem
        // Refetch die vorigen `data`, sonst bliebe der Takt der reguläre, während die Ebene schon
        // `offline` zeigt.
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
    if (!mergeEnergieFeatures(sammlung, fc.features, ENERGIE_AKKU_MAX)) return;
    setEnergieAkku({ type: 'FeatureCollection', features: [...sammlung.values()] });
  }, [kombiniert.energieRoh]);

  // Nennungsteile sammeln sich über die Zeit; gezeigt wird, was die gesammelten Punkte tragen.
  useEffect(() => {
    const attribution = kombiniert.energieAttributionRoh;
    if (!attribution) return;
    const neu = attribution
      .split(NENNUNG_TRENNER)
      .map((t) => t.trim())
      .filter(Boolean);
    // Bestand zurückgeben, wenn nichts Neues dabei ist — sonst rendert jeder Refetch neu.
    setEnergieTeile((alt) => {
      const dazu = neu.filter((t) => !alt.includes(t));
      return dazu.length ? [...alt, ...dazu] : alt;
    });
  }, [kombiniert.energieAttributionRoh]);

  // Setzen mit demselben Wert ist in React ein No-op → keine Renderschleife.
  useEffect(() => {
    setAutobahnStatus(kombiniert.autobahnStatusRoh);
  }, [kombiniert.autobahnStatusRoh]);

  // „Zu weit herausgezoomt" bzw. „Ausschnitt zu groß" je Quelle, nur für sichtbare Ebenen mit
  // `minZoom` (heute allein Energie). Die Sidebar liest es für jede bbox-Ebene gleich.
  const zoomZuKlein: Partial<Record<FachebeneQuelle, boolean>> = {};
  for (const k of fachebeneKeys()) {
    const minZoom = FACHEBENEN[k].minZoom;
    if (minZoom === undefined || !fachebenenSichtbar[k] || kartenZoom === null) continue;
    zoomZuKlein[k] = kartenZoom < minZoom || (k === 'energie' && energieBboxZuGross);
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
