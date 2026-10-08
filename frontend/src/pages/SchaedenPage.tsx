import { IconOrtsmarke } from '../icons';
import StatusTag from '../components/StatusTag';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { schadenDetailPfad, schaedenDruckPfad } from '../routing/deeplinks';
import { Alert, Breadcrumb, Button, Tag, Typography, theme } from 'antd';
import { Segmentleiste, monoStil } from '../components/instrument';
import { einsatzKeys } from '../api/queryKeys';
import { ladeEinsatz } from '../api/einsaetze';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { useAuth } from '../auth/AuthContext';
import {
  ladeSchadenKennzahlen,
  listeSchaedenSeite,
  SCHADEN_SORTIERUNG_VORGABE,
  schadenCursor,
  SCHAEDEN_SEITE,
  schadenRegistrierAnzeige,
  type SchaedenFilter,
  type SchadenCursor,
  type SchadenSortierung,
  type SchadenSortSpalte,
} from '../api/einsatzSchaden';
import type { Ausmass, Schaden, SchadenTyp } from '../api/types';
import {
  AUSMASS_META,
  STATUS_META,
  TYP_LABEL,
  geschaedigtAnzeige,
  SCHAEDEN_SICHTEN,
  type SchaedenSicht,
} from './schaeden/schadenHelfer';
import SchadenErfassenModal from './schaeden/SchadenErfassenModal';
import Datensicht, {
  spaltenFuer,
  type DatensichtSortierung,
  type Kartenplan,
} from '../components/Datensicht';
import { SeitenFehler, SeitenSkeleton, SeitenStandVeraltet } from '../components/SeitenZustand';
import EinsatzSeite from '../components/EinsatzSeite';
import ZeitAnzeige from '../anzeige/ZeitAnzeige';
import { modulName } from '../einsatz/modulRegistry';

/**
 * Das eine Spaltenregister der Schadensliste. Funktion von `einsatzId`, weil die Geschädigt-Spalte
 * Deeplinks baut (`geschaedigtAnzeige(s, einsatzId)`). Durch `spaltenFuer<Schaden>()` geführt, nie
 * annotiert: eine Annotation weitete die Schlüsselliterale auf `string`.
 *
 * Typ und Ausmaß sind Spaltenfilter: geschlossene Wertemengen aus `schadenHelfer`, dort, wo die
 * Werte stehen. Die Reiterachse (Status) bleibt außen — sie ist das Arbeitsfach, nicht eine
 * Einengung darin.
 */
const schaedenSpalten = (einsatzId: number) =>
  spaltenFuer<Schaden>()([
    {
      title: 'Reg.-Nr.',
      key: 'reg',
      immerSichtbar: true,
      // Über die Zahl sortiert — über den Text läge „S-10" vor „S-9".
      sortWert: (s) => s.registrier_nr,
      suchText: (s) => schadenRegistrierAnzeige(s.registrier_nr),
      // Kein Anker: den Titel-Link setzt der Kartenplan über `titel.ziel`, in beiden Zweigen.
      render: (_, s) => (
        <Typography.Text strong style={monoStil(13, 500)}>
          {schadenRegistrierAnzeige(s.registrier_nr)}
        </Typography.Text>
      ),
    },
    {
      title: 'Typ',
      key: 'typ',
      sortWert: (s) => TYP_LABEL[s.typ],
      filter: {
        werte: (Object.keys(TYP_LABEL) as SchadenTyp[]).map((t) => ({
          text: TYP_LABEL[t],
          value: t,
        })),
        trifft: (s, wert) => s.typ === wert,
      },
      render: (_, s) => <Tag>{TYP_LABEL[s.typ]}</Tag>,
    },
    {
      title: 'Ausmaß',
      key: 'ausmass',
      // Nach Schwere sortiert, nicht alphabetisch — „mittel" fiele sonst ans Ende.
      sortWert: (s) => (Object.keys(AUSMASS_META) as Ausmass[]).indexOf(s.ausmass),
      filter: {
        werte: (Object.keys(AUSMASS_META) as Ausmass[]).map((a) => ({
          text: AUSMASS_META[a].label,
          value: a,
        })),
        trifft: (s, wert) => s.ausmass === wert,
      },
      render: (_, s) => <StatusTag darstellung={AUSMASS_META[s.ausmass]} />,
    },
    {
      title: 'Ort',
      key: 'ort',
      ellipsis: true,
      sortWert: (s) => s.ort,
      // Die Beschreibung trägt zur Suche bei, ohne eigene Spalte: Fließtext ist in einer
      // Vergleichstabelle nicht lesbar, aber das, wonach sucht, wer den Ort nicht mehr weiß.
      suchText: (s) => [s.ort, s.beschreibung].filter(Boolean).join(' '),
      render: (_, s) => s.ort,
    },
    {
      title: 'Status',
      key: 'status',
      render: (_, s) => (
        <StatusTag
          darstellung={{
            ...STATUS_META[s.status],
            label:
              STATUS_META[s.status].label +
              (s.status === 'uebergeben' && s.uebergeben_an ? ` (${s.uebergeben_an})` : ''),
          }}
        />
      ),
    },
    {
      title: 'seit',
      key: 'seit',
      /**
       * Alter des Eintrags aus `erfasst_at`, nicht `geaendert_at`: das läuft bei jeder Übergabe und
       * jedem Statuswechsel weiter und beantwortet „wann zuletzt angefasst", nicht „seit wann
       * offen" (wie in `TierePage.tsx`).
       *
       * Keine Breitenschwelle: die Zeitachse ist der Zweck der Spalte.
       */
      sortWert: (s) => s.erfasst_at,
      render: (_, s) => <ZeitAnzeige wert={s.erfasst_at} />,
    },
    {
      title: 'Verortet',
      key: 'verortet',
      /**
       * Welche Schäden stehen auf der Karte? Die Frage, mit der man vor der Karte sitzt.
       *
       * Als Icon, nicht als Emoji. Das Icon des Satzes ist selbst `aria-hidden` (LFH-595); die
       * Hülle bleibt als zweite Sicherung gegen ein Vorleseziel in jeder Zeile.
       *
       * Filterachse statt Sortierung: „zeig mir die Unverorteten" ist die Arbeitsfrage.
       */
      sortWert: (s) => (s.lat != null && s.lon != null ? 1 : 0),
      filter: {
        werte: [
          { text: 'verortet', value: 'ja' },
          { text: 'nicht verortet', value: 'nein' },
        ],
        trifft: (s, wert) => (s.lat != null && s.lon != null) === (wert === 'ja'),
      },
      render: (_, s) =>
        s.lat != null && s.lon != null ? (
          <span aria-label="verortet" role="img">
            <IconOrtsmarke />
          </span>
        ) : (
          <Typography.Text type="secondary" aria-label="nicht verortet" role="img">
            —
          </Typography.Text>
        ),
    },
    {
      title: 'Geschädigt',
      key: 'geschaedigt',
      abBreite: 'lg',
      suchText: (s) =>
        s.geschaedigt_personal_name ?? s.geschaedigt_organisation_name ?? s.geschaedigt_kontakt,
      render: (_, s) => geschaedigtAnzeige(s, einsatzId),
    },
  ]);

type SchadenSpaltenKey = ReturnType<typeof schaedenSpalten>[number]['key'];

/** Sortierbare Spalten und ihr Schlüssel am Server (`SortSpalte`, LFH-1075). */
const SERVER_SPALTE: Partial<Record<SchadenSpaltenKey, SchadenSortSpalte>> = {
  reg: 'nr',
  typ: 'typ',
  ausmass: 'ausmass',
  ort: 'ort',
  seit: 'erfasst',
  verortet: 'verortet',
};

/** Keine Sortierung heißt Serverordnung: jüngste Nummer zuerst. */
function serverSortierung(s: DatensichtSortierung<SchadenSpaltenKey>): SchadenSortierung {
  const spalte = s && SERVER_SPALTE[s.spalte];
  return spalte && s ? { spalte, richtung: s.richtung } : SCHADEN_SORTIERUNG_VORGABE;
}

/**
 * Filter der Modulseite für den Server. Leere Felder fehlen, damit gleiche Sichten denselben
 * Query-Key tragen.
 */
function serverFilter(
  sicht: SchaedenSicht,
  suche: string,
  spaltenFilter: Readonly<Record<string, readonly string[]>>,
): SchaedenFilter {
  const f: SchaedenFilter = {};
  if (sicht !== 'alle') f.status = sicht;
  if (spaltenFilter.typ?.length) f.typen = spaltenFilter.typ as SchadenTyp[];
  if (spaltenFilter.ausmass?.length) f.ausmasse = spaltenFilter.ausmass as Ausmass[];
  if (spaltenFilter.verortet?.length) f.verortet = spaltenFilter.verortet as ('ja' | 'nein')[];
  if (suche) f.q = suche;
  return f;
}

const schadenKarte = (einsatzId: number): Kartenplan<Schaden, SchadenSpaltenKey> => ({
  art: 'plan',
  titel: { spalte: 'reg', ziel: (s) => schadenDetailPfad(einsatzId, s.id) },
  sekundaer: ['ort', 'ausmass', 'seit'],
});

export default function SchaedenPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { benutzer } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const { token } = theme.useToken();
  const [sicht, setSicht] = useState<SchaedenSicht>('offen');
  // Suche, Spaltenfilter und Sortierung wirken am Server (LFH-1075); `Datensicht` meldet sie.
  const [suche, setSuche] = useState('');
  const [spaltenFilter, setSpaltenFilter] = useState<Readonly<Record<string, readonly string[]>>>(
    {},
  );
  const [sortierung, setSortierung] = useState<DatensichtSortierung<SchadenSpaltenKey>>({
    spalte: 'reg',
    richtung: 'ab',
  });
  const wechsleSicht = useCallback((s: SchaedenSicht) => {
    // Die Sicht baut `Datensicht` neu auf (Schlüssel), Suche und Spaltenfilter beginnen leer.
    setSicht(s);
    setSuche('');
    setSpaltenFilter({});
  }, []);

  const [erfassenOffen, setErfassenOffen] = useState(false);

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });

  /**
   * Die Liste lädt seitenweise (LFH-1075, Spec `schaden-liste-blaettern`). Der Einsatz-Live-Stream
   * im EinsatzLayout hält die geladenen Seiten per Zeilenabgleich aktuell und die Kennzahlen per
   * Abgleich (`live/zeilenAbgleich.ts`).
   */
  const filter = useMemo(
    () => serverFilter(sicht, suche, spaltenFilter),
    [sicht, suche, spaltenFilter],
  );
  const sortierungAmServer = useMemo(() => serverSortierung(sortierung), [sortierung]);
  const seitenKey = einsatzKeys.schaedenSeiten(einsatzId, filter, sortierungAmServer);
  const schaedenQuery = useInfiniteQuery({
    queryKey: seitenKey,
    queryFn: ({ pageParam }) =>
      listeSchaedenSeite(einsatzId, filter, sortierungAmServer, pageParam),
    initialPageParam: undefined as SchadenCursor | undefined,
    getNextPageParam: (letzte) =>
      letzte.length < SCHAEDEN_SEITE
        ? undefined
        : schadenCursor(letzte[letzte.length - 1], sortierungAmServer.spalte),
    // Bis die Antwort auf Suche, Filter oder Sortierung da ist, bleiben die alten Zeilen stehen.
    placeholderData: keepPreviousData,
  });
  const filterOhneStatus = useMemo(
    () => serverFilter('alle', suche, spaltenFilter),
    [suche, spaltenFilter],
  );
  // Kopfzeile: der ganze Bestand. Ausschnitt: dieselben Filter wie die Liste, ohne den Status.
  const bestandQuery = useQuery({
    queryKey: einsatzKeys.schaedenKennzahlen(einsatzId, {}),
    queryFn: () => ladeSchadenKennzahlen(einsatzId, {}),
  });
  const ausschnittQuery = useQuery({
    queryKey: einsatzKeys.schaedenKennzahlen(einsatzId, filterOhneStatus),
    queryFn: () => ladeSchadenKennzahlen(einsatzId, filterOhneStatus),
  });

  const darfSchreibenRoh = darfImEinsatzSchreiben(einsatzQuery.data, benutzer);
  const spalten = useMemo(() => schaedenSpalten(einsatzId), [einsatzId]);

  // Schnellaktion: ?neu=1 öffnet die Erfassung (Command-Palette). Warten bis der Einsatz geladen
  // ist; Param immer löschen, Modal nur bei Schreibrecht.
  useEffect(() => {
    if (searchParams.get('neu') !== '1') return;
    if (einsatzQuery.isLoading) return;
    if (darfSchreibenRoh) setErfassenOffen(true);
    searchParams.delete('neu');
    setSearchParams(searchParams, { replace: true });
  }, [searchParams, setSearchParams, einsatzQuery.isLoading, darfSchreibenRoh]);

  /**
   * Seitenzustand — nur `einsatzQuery`: Breadcrumb, Titelzeile und Einsatz-Status hängen an
   * `einsatzQuery.data`; ohne sie gibt es keinen Rahmen für einen Listenfehler. Dieselbe Antwort
   * wie auf `PersonenPage`/`TierePage`.
   */
  if (einsatzQuery.isLoading) {
    return <SeitenSkeleton />;
  }
  if (einsatzQuery.isError || !einsatzQuery.data) {
    return (
      <SeitenFehler
        text="Einsatz nicht gefunden oder kein Zugriff"
        ursache={einsatzQuery.error}
        onWiederholen={() => void einsatzQuery.refetch()}
      />
    );
  }
  const einsatz = einsatzQuery.data;
  const darfSchreiben = darfImEinsatzSchreiben(einsatz, benutzer);

  const geladen = schaedenQuery.data?.pages.flat() ?? [];
  const ausschnitt = ausschnittQuery.data;
  const ausschnittZahl = ausschnitt && (sicht === 'alle' ? ausschnitt.gesamt : ausschnitt[sicht]);

  /**
   * Listenzustand — an der Stelle der Liste entschieden, nie als Frühausstieg.
   *
   * Gemessen an den geladenen Zeilen der jetzigen Sicht.
   *
   * Ohne Zeilen tritt der Fehler an die Stelle der Liste, sonst behauptete „Keine Schäden in dieser
   * Sicht" eine leere Menge. Mit Zeilen bleiben sie stehen und bekommen ein Banner. Der Ladezweig
   * liegt am Primitiv (`ladend`).
   */
  const listeGescheitert = schaedenQuery.isError && geladen.length === 0;
  const standVeraltet = schaedenQuery.isError && geladen.length > 0;

  const orgId = einsatz.org_id ?? 0;

  return (
    <EinsatzSeite
      dataUpdatedAt={schaedenQuery.dataUpdatedAt}
      meta={
        bestandQuery.data
          ? `${bestandQuery.data.gesamt} Schäden · ${bestandQuery.data.offen} offen`
          : undefined
      }
      titel={modulName('schaeden')}
      breadcrumb={
        <Breadcrumb
          items={[
            { title: <Link to="/einsaetze">Einsätze</Link> },
            { title: einsatz.bezeichnung },
            { title: modulName('schaeden') },
          ]}
        />
      }
      aktionen={
        darfSchreiben && (
          <Button type="primary" onClick={() => setErfassenOffen(true)}>
            Schnellerfassung
          </Button>
        )
      }
      // Drucken öffnet und sendet nichts ab: Nebenweg, unter `md` hinter „Weitere"
      // (`frontend/AGENTS.md`, Aktionen). Drucken ist Lesen — ohne Schreib-Riegel.
      weitere={{
        name: 'Weitere Aktionen zu den Schäden',
        eintraege: [
          {
            key: 'druck',
            label: 'Drucken / als PDF',
            ziel: schaedenDruckPfad(einsatzId, { sicht }),
            onWahl: () => navigate(schaedenDruckPfad(einsatzId, { sicht })),
          },
        ],
      }}
      // Zweiter Bedienweg auf die Primäraktion („Neue Zeile" in der Palette) — mit demselben
      // Rechte-Riegel wie der Knopf.
      neueZeile={darfSchreiben ? () => setErfassenOffen(true) : undefined}
      hinweis={
        !darfSchreiben &&
        einsatz.status !== 'aktiv' && (
          <Alert type="info" showIcon title="Einsatz ist abgeschlossen — nur Ansicht." />
        )
      }
    >
      {/* Statusfilter als Segmentleiste: eine Wahl, die die Liste darunter filtert —
          `radiogroup`, kein Reiterfeld je Segment. */}
      <Segmentleiste
        beschriftung="Schäden nach Status filtern"
        wert={sicht}
        onWechsel={wechsleSicht}
        optionen={SCHAEDEN_SICHTEN.map((s) => ({ wert: s.key, label: s.label }))}
        style={{ marginBottom: 12 }}
      />

      {listeGescheitert ? (
        <SeitenFehler
          text="Schäden konnten nicht geladen werden"
          ursache={schaedenQuery.error}
          onWiederholen={() => void schaedenQuery.refetch()}
        />
      ) : (
        <>
          {standVeraltet && (
            <SeitenStandVeraltet onWiederholen={() => void schaedenQuery.refetch()} />
          )}

          <Datensicht
            /**
             * Vier Reiter, eine Sichtstelle — der Schlüssel trägt deshalb die Statusachse. Ohne ihn
             * reichte React dieselbe Instanz über alle vier Mengen weiter, und Suchbegriff und
             * Spaltenfilter im Primitiv filterten eine fremde Menge: im Reiter „Offen" nach einer
             * Straße gesucht, auf „Alle" gewechselt, und dort fehlen still Zeilen. Dieselbe Falle
             * ist an `PersonenPage` und `TierePage` behoben.
             */
            key={sicht}
            bezeichnung="Schäden im Einsatz"
            spalten={spalten}
            daten={geladen}
            zeilenSchluessel="id"
            ladend={schaedenQuery.isLoading}
            leerText="Keine Schäden in dieser Sicht"
            suche={{ platzhalter: 'S-Nr., Ort, Beschreibung' }}
            // Vorgabe wie die Serverordnung: der jüngste Schaden oben. Ein Sortierklick lädt neu.
            sortierung={sortierung}
            onSortierung={setSortierung}
            serverseitig={{
              // Die alten Zeilen bis zur Antwort sind kein eigener Stand.
              stand: schaedenQuery.isPlaceholderData ? 'vorläufig' : JSON.stringify(seitenKey),
              onSuche: setSuche,
              onFilter: setSpaltenFilter,
            }}
            onZeileKlick={(s) => navigate(schadenDetailPfad(einsatzId, s.id))}
            karte={schadenKarte(einsatzId)}
          />
          {schaedenQuery.hasNextPage &&
            (ausschnittZahl == null || geladen.length < ausschnittZahl) && (
              <div style={{ textAlign: 'center', marginTop: token.margin }}>
                <Button
                  onClick={() => void schaedenQuery.fetchNextPage()}
                  loading={schaedenQuery.isFetchingNextPage}
                >
                  Ältere laden
                </Button>
                {ausschnittZahl != null && (
                  <div style={{ marginTop: token.marginXS, color: token.colorTextSecondary }}>
                    {geladen.length} von {ausschnittZahl} geladen
                  </div>
                )}
              </div>
            )}
        </>
      )}

      <SchadenErfassenModal
        open={erfassenOffen}
        onClose={() => setErfassenOffen(false)}
        einsatzId={einsatzId}
        orgId={orgId}
        orgName={einsatz.org_name ?? 'Eigene Organisation'}
      />
    </EinsatzSeite>
  );
}
