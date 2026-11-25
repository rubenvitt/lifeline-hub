import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { theme } from 'antd';
import { keepPreviousData, useQueries, useQuery } from '@tanstack/react-query';
import {
  ladeFachebene,
  loadDrohneFachebene,
  type FachebeneQuelle,
  type FachebeneStatus,
  type FeatureCollection,
} from '../../api/fachebenen';
import {
  copernicusAktivierungen,
  copernicusBilder,
  fitsCopernicusAusschnitt,
  fitsEnergieAusschnitt,
  energieNennung,
  FACHEBENEN,
  fachebeneKeys,
  fachebeneTakt,
  mergeEnergieFeatures,
  NENNUNG_TRENNER,
} from './fachebenen';
import type { FachebenenSichtbar } from './fachebenenAuswahl';
import type { AktiveFachebene } from './kartenLayer';
import { globalKeys } from '../../api/queryKeys';
import { useMinutenTakt } from '../../components/useMinutenTakt';
import { fachebeneFarbe } from '../../theme/statusFarben';
import { dwdGueltigkeit } from './dwdGueltigkeit';

type Feature = FeatureCollection['features'][number];

/**
 * Obergrenze der Energie-Sammlung (älteste zuerst raus). Der Rauschfilter lässt nur Großanlagen
 * durch, 2000 reicht weit.
 */
const ENERGIE_AKKU_MAX = 2000;

const leereFc = (): FeatureCollection => ({ type: 'FeatureCollection', features: [] });

interface FachebenenArgs {
  /** Einsatz der Karte: die Drohnenlage lädt über seine Route (LLH-2106). */
  einsatzId: number;
  /** Sichtbarkeit + Setter kommen aus useKartenAnsicht (geteilte Ansicht = Wahrheit). */
  fachebenenSichtbar: FachebenenSichtbar;
  setFachebenenSichtbar: Dispatch<SetStateAction<FachebenenSichtbar>>;
}

/**
 * Liegezeit einer nicht mehr gezeigten KRITIS- bzw. Energie-Antwort im Cache (LFH-945, D6). Der
 * Schlüssel trägt die gerasterte bbox, jede besuchte Zelle ist ein eigener Eintrag von grob 1–3 MB
 * (bis 5 000 Objekte). Mit 6 h lag alles im Speicher, was in den letzten 6 h zu sehen war. Gebraucht
 * wird der gerade gezeigte Ausschnitt, der Vorgänger für `keepPreviousData` (beobachtet, also nicht
 * betroffen) und ein kurzes Zurückschieben — dafür reichen 5 min. Die `staleTime` bleibt eigen.
 */
const BBOX_ABFRAGE_GC_MS = 5 * 60_000;

/** Deckkraft der Satellitenbilder in Prozent, bis jemand sie ändert (LLH-2021). */
export const BILDER_DECKKRAFT_VORGABE = 80;

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

export function useFachebenen({
  einsatzId,
  fachebenenSichtbar,
  setFachebenenSichtbar,
}: FachebenenArgs) {
  // Hochwasser, ODL und Luftqualität färben je Punkt nach Stufe und brauchen den aufgelösten
  // Modus-Token; die Kartenstil-Module haben ihn bewusst nicht, also wird er hier in die Features
  // gebacken.
  const { token } = theme.useToken();
  // Die DWD-Warnungen altern ohne Abruf: abgelaufene fallen weg, angekündigte werden geltend
  // (LFH-662, `dwdGueltigkeit`). Derselbe Takt wie die Marke „veraltet“ (`FachebeneStand`).
  const jetzt = useMinutenTakt();
  // Ein Ausschnitt für alle bbox-abhängigen Ebenen: die Karte hat nur einen Viewport.
  const [viewportBbox, setViewportBbox] = useState<string | null>(null);
  // Zuletzt gesehener Status der Autobahn-Ebene — steuert ihren Poll-Takt (Aufwärmphase).
  const [autobahnStatus, setAutobahnStatus] = useState<FachebeneStatus | undefined>(undefined);
  // Dasselbe für die Lkw-Parkplätze (LLH-1637), deren erster Lauf ebenfalls im Hintergrund hängt.
  const [parkenStatus, setParkenStatus] = useState<FachebeneStatus | undefined>(undefined);
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
  const energieBboxZuGross = viewportBbox !== null && !fitsEnergieAusschnitt(viewportBbox);
  const energiePasst = energieZoomReicht && viewportBbox !== null && !energieBboxZuGross;
  // In Energie-Antworten gesehene Nennungsteile. Gezeigt wird, was die gesammelten Punkte tragen
  // (`energieNennung`), nicht die Nennung der letzten Antwort.
  const [energieTeile, setEnergieTeile] = useState<string[]>([]);

  // Copernicus (LLH-1200): bbox-abhängig wie Energie, mit denselben Riegeln für Zoom und Spanne.
  // Der Archiv-Schalter lebt nur im Speicher: Wer die Seite neu lädt, sieht wieder nur Aktuelles,
  // sonst mischte ein vergessener Schalter die Flut von 2024 in eine neue Lage.
  const [copernicusArchiv, setCopernicusArchiv] = useState(false);
  const copernicusMinZoom = FACHEBENEN.copernicus.minZoom;
  const copernicusZoomReicht =
    copernicusMinZoom === undefined || (kartenZoom !== null && kartenZoom >= copernicusMinZoom);
  const copernicusBboxZuGross = viewportBbox !== null && !fitsCopernicusAusschnitt(viewportBbox);
  const copernicusPasst = copernicusZoomReicht && viewportBbox !== null && !copernicusBboxZuGross;
  // Satellitenbilder (LLH-2021): dieselben Riegel und derselbe Archiv-Schalter. Die Deckkraft lebt
  // wie der Schalter nur im Speicher.
  const [bilderDeckkraft, setBilderDeckkraft] = useState(BILDER_DECKKRAFT_VORGABE);

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
    gcTime: BBOX_ABFRAGE_GC_MS,
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
    gcTime: BBOX_ABFRAGE_GC_MS,
  });

  const copernicus = useQuery({
    queryKey: globalKeys.fachebeneCopernicus(viewportBbox, copernicusArchiv),
    queryFn: () => ladeFachebene('copernicus', viewportBbox!, copernicusArchiv),
    enabled: fachebenenSichtbar.copernicus && copernicusPasst,
    // Wie KRITIS: die Antwort ersetzt das Bild, beim Pannen bleibt das bisherige stehen.
    placeholderData: keepPreviousData,
    gcTime: BBOX_ABFRAGE_GC_MS,
    // Regulär 10 min, solange der kalte Abruf im Hintergrund läuft der Aufwärmtakt.
    refetchInterval: (q) =>
      fachebeneTakt('copernicus', q.state.status === 'error' ? 'offline' : q.state.data?.status),
  });

  const copernicusBilderQuery = useQuery({
    queryKey: globalKeys.fachebeneCopernicusBilder(viewportBbox, copernicusArchiv),
    queryFn: () => ladeFachebene('copernicus_bilder', viewportBbox!, copernicusArchiv),
    enabled: fachebenenSichtbar.copernicus_bilder && copernicusPasst,
    placeholderData: keepPreviousData,
    gcTime: BBOX_ABFRAGE_GC_MS,
    refetchInterval: (q) =>
      fachebeneTakt(
        'copernicus_bilder',
        q.state.status === 'error' ? 'offline' : q.state.data?.status,
      ),
  });

  // Die Drohnenlage (LLH-2106) hängt am Einsatz und läuft darum als eigenes `useQuery` mit
  // Einsatz-ID im Key, nicht im positionsweise gelesenen Tupel unten. Ihr Takt ist fest; ein Poll
  // ohne neuen Stand kostet ein 304.
  const drohne = useQuery({
    queryKey: globalKeys.fachebeneDrohne(einsatzId),
    queryFn: () => loadDrohneFachebene(einsatzId),
    enabled: fachebenenSichtbar.drohne,
    refetchInterval: FACHEBENEN.drohne.pollMs,
  });

  // Acht Fachebenen-Queries als ein `useQueries` + `combine`, in der Reihenfolge von
  // `fachebeneKeys()` ohne kritis, energie, copernicus, copernicus_bilder und drohne (nicht
  // Panel-Reihenfolge). `byKey` greift
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
        // Takt (120 s) sähe man zwei Minuten nichts.
        //
        // State statt Callback-Form von `refetchInterval`: die Callback-Form lässt die Typinferenz
        // dieses `useQueries`-Tupels kollabieren (alles `UseQueryResult<unknown>`, `combine`
        // verliert seine Typen).
        refetchInterval: fachebeneTakt('autobahn', autobahnStatus),
      },
      // Bewusst hinten: `byKey` greift positionsweise ab.
      {
        queryKey: globalKeys.fachebene('luftqualitaet'),
        queryFn: () => ladeFachebene('luftqualitaet'),
        enabled: fachebenenSichtbar.luftqualitaet,
        refetchInterval: FACHEBENEN.luftqualitaet.pollMs,
      },
      // LLH-1637, hinter Luftqualität angehängt: `byKey` greift positionsweise ab.
      {
        queryKey: globalKeys.fachebene('autobahn_parken'),
        queryFn: () => ladeFachebene('autobahn_parken'),
        enabled: fachebenenSichtbar.autobahn_parken,
        refetchInterval: fachebeneTakt('autobahn_parken', parkenStatus),
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
        copernicus,
        copernicus_bilder: copernicusBilderQuery,
        drohne,
        autobahn: ergebnisse[5],
        luftqualitaet: ergebnisse[6],
        autobahn_parken: ergebnisse[7],
      } as const;
      const leerFc: FeatureCollection = { type: 'FeatureCollection', features: [] };
      const aktiveFachebenen: AktiveFachebene[] = fachebeneKeys()
        .filter((k) => fachebenenSichtbar[k])
        .map((k) => {
          // Energie aus ihrer Sammlung; Ebenen mit Klassenfarben (Hochwasser, ODL, Luftqualität)
          // mit eingebackener Farbe und Punktgröße — über dieselbe Eigenschaft, die im Panel die
          // Legende trägt (LFH-592); DWD nach Gültigkeit (LFH-662); übrige Quellen direkt aus der
          // Query.
          const def = FACHEBENEN[k];
          const roh = byKey[k].data?.features ?? leerFc;
          const daten =
            k === 'energie'
              ? energieAkku
              : k === 'dwd'
                ? dwdGueltigkeit(roh, jetzt)
                : def.klassenfarben
                  ? def.klassenfarben.faerbe(roh, token)
                  : roh;
          return {
            def,
            daten,
            farbe: fachebeneFarbe(k, token),
            treffer: token.controlHeight,
            ...(def.darstellung === 'raster' ? { deckkraft: bilderDeckkraft } : {}),
          };
        });

      const fachebenenStatus: Partial<Record<FachebeneQuelle, FachebeneStatus>> = {};
      const fachebenenLaedt: Partial<Record<FachebeneQuelle, boolean>> = {};
      // Abrufzeitpunkt des Servers (LFH-591) — auch bei `isError`: react-query hält dann die
      // vorigen `data`, die Karte zeichnet sie weiter, und ihr Alter muss sichtbar bleiben.
      const fachebenenAbgerufen: Partial<Record<FachebeneQuelle, string>> = {};
      for (const k of fachebeneKeys()) {
        if (!fachebenenSichtbar[k]) continue;
        const q = byKey[k];
        fachebenenStatus[k] = q.isError ? 'offline' : q.data?.status;
        fachebenenLaedt[k] = q.isFetching;
        const abgerufen = q.data?.abgerufen;
        if (abgerufen) fachebenenAbgerufen[k] = abgerufen;
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
        .filter(Boolean)
        // Beide Copernicus-Ebenen nennen dieselbe Quelle; sie steht einmal da.
        .filter((n, i, alle) => alle.indexOf(n) === i);

      return {
        aktiveFachebenen,
        fachebenenStatus,
        fachebenenLaedt,
        fachebenenAbgerufen,
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
        parkenStatusRoh: byKey.autobahn_parken.isError
          ? 'offline'
          : byKey.autobahn_parken.data?.status,
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
  useEffect(() => {
    setParkenStatus(kombiniert.parkenStatusRoh);
  }, [kombiniert.parkenStatusRoh]);

  // „Zu weit herausgezoomt" bzw. „Ausschnitt zu groß" je Quelle, nur für sichtbare Ebenen mit
  // `minZoom` (heute allein Energie). Die Sidebar liest es für jede bbox-Ebene gleich.
  const zoomZuKlein: Partial<Record<FachebeneQuelle, boolean>> = {};
  for (const k of fachebeneKeys()) {
    const minZoom = FACHEBENEN[k].minZoom;
    if (minZoom === undefined || !fachebenenSichtbar[k] || kartenZoom === null) continue;
    zoomZuKlein[k] =
      kartenZoom < minZoom ||
      (k === 'energie' && energieBboxZuGross) ||
      ((k === 'copernicus' || k === 'copernicus_bilder') && copernicusBboxZuGross);
  }

  // EMSR-Nummern im Ausschnitt mit jüngster Aufnahme, für die Zeile im Ebenenbaum.
  const copernicusFeatures = copernicus.data?.features;
  const copernicusListe = useMemo(
    () => (copernicusFeatures ? copernicusAktivierungen(copernicusFeatures) : []),
    [copernicusFeatures],
  );

  const bilderFeatures = copernicusBilderQuery.data?.features;
  const bilderListe = useMemo(
    () => (bilderFeatures ? copernicusBilder(bilderFeatures) : []),
    [bilderFeatures],
  );

  const onFachebeneToggle = (k: FachebeneQuelle, an: boolean) =>
    setFachebenenSichtbar((s) => ({ ...s, [k]: an }));

  return {
    fachebenenSichtbar,
    onFachebeneToggle,
    aktiveFachebenen: kombiniert.aktiveFachebenen,
    fachebenenStatus: kombiniert.fachebenenStatus,
    fachebenenLaedt: kombiniert.fachebenenLaedt,
    fachebenenAbgerufen: kombiniert.fachebenenAbgerufen,
    fachebenenAttribution: kombiniert.fachebenenAttribution,
    zoomZuKlein,
    copernicus: {
      archiv: copernicusArchiv,
      onArchiv: setCopernicusArchiv,
      aktivierungen: copernicusListe,
    },
    copernicusBilder: {
      liste: bilderListe,
      deckkraft: bilderDeckkraft,
      onDeckkraft: setBilderDeckkraft,
    },
    setViewportBbox,
    setKartenZoom,
  };
}
