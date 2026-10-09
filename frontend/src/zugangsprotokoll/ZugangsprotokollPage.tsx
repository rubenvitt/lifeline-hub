import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Navigate, useSearchParams } from 'react-router';
import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
  type InfiniteData,
  type UseInfiniteQueryResult,
} from '@tanstack/react-query';
import { AutoComplete, Button, Space, theme } from 'antd';
import { listeBenutzer } from '../api/benutzer';
import { globalKeys, type ZugangsprotokollSpur } from '../api/queryKeys';
import type { AdminAktion, AnmeldeEintrag, AnmeldeEreignis, Zugangsaenderung } from '../api/types';
import {
  ladeAnmeldungen,
  ladeZugangsaenderungen,
  naechsteVorId,
  type SpurFilter,
} from '../api/zugangsprotokoll';
import { defaultAdminPfad } from '../admin/adminNav';
import { OrgAnzeigeProvider } from '../anzeige/AnzeigeKonventionenContext';
import ZeitAnzeige from '../anzeige/ZeitAnzeige';
import { ZeitpunktEingabe } from '../anzeige/ZeitpunktEingabe';
import { alsBackendZeit, alsZeitpunkt } from '../anzeige/zeitEingabe';
import { useAuth } from '../auth/AuthContext';
import AdminPage from '../components/AdminPage';
import Datensicht, { spaltenFuer, type Kartenplan } from '../components/Datensicht';
import { SeitenFehler, SeitenStandVeraltet } from '../components/SeitenZustand';
import { Select } from '../components/Select';
import { teilwortSuche } from '../components/teilwortSuche';
import { Segmentleiste } from '../components/instrument';
import { istAdmin } from '../einsatz/schreibrecht';
import {
  AKTION_TEXT,
  EREIGNIS_TEXT,
  anmeldewegText,
  istAktion,
  istEreignis,
} from './zugangsprotokollText';

/**
 * Zugangsprotokoll der Verwaltung (LFH-1097) — `/admin/zugangsprotokoll`, nur System-Admin
 * (sonst Rückleitung in die Verwaltung). Zwei Spuren hinter einer Segmentleiste: Admin-Spur
 * („Zugangsänderungen“, Vorgabe) und Anmeldespur. Herleitung: `/mnt/project-files/lfh-1097/design.md`.
 *
 * Tabelle in jeder Breite: verglichen wird über Zeilen („wann, wer, von wo“). Die Liste blättert
 * am Server (neueste zuerst, „Ältere laden“), deshalb Servermodus der `Datensicht` ohne Suche,
 * Spaltenfilter und Sortierung: die Filter stehen in der Leiste darüber und in der URL. Kein
 * Live-Abgleich: geladen wird beim Öffnen und bei Filterwechsel.
 */

const leer = '—';

/** Frist der Entprellung des Kontofelds. */
const ENTPRELLUNG_MS = 300;

const SPUREN: { wert: ZugangsprotokollSpur; label: string }[] = [
  { wert: 'zugangsaenderungen', label: 'Zugangsänderungen' },
  { wert: 'anmeldungen', label: 'Anmeldungen' },
];

/** Der Filter der Seite, wie er in der URL steht. Unbrauchbare Werte fallen ganz weg. */
interface SeitenFilter extends SpurFilter {
  spur: ZugangsprotokollSpur;
  ereignis?: AnmeldeEreignis;
  aktion?: AdminAktion;
}

/** URL → Filter. Exportiert für den Test. */
export function parseZugangsprotokollFilter(p: URLSearchParams): SeitenFilter {
  const zeit = (name: string) => {
    const d = alsZeitpunkt(p.get(name));
    return d ? alsBackendZeit(d) : undefined;
  };
  const konto = p.get('konto')?.trim() || undefined;
  const ereignis = p.get('ereignis');
  const aktion = p.get('aktion');
  return {
    spur: p.get('spur') === 'anmeldungen' ? 'anmeldungen' : 'zugangsaenderungen',
    von: zeit('von'),
    bis: zeit('bis'),
    konto,
    ereignis: istEreignis(ereignis) ? ereignis : undefined,
    aktion: istAktion(aktion) ? aktion : undefined,
  };
}

/** Filter → URL; leere Werte fehlen, die Vorgabespur auch. */
function alsSuchparameter(f: SeitenFilter): URLSearchParams {
  const p = new URLSearchParams();
  if (f.spur !== 'zugangsaenderungen') p.set('spur', f.spur);
  for (const name of ['von', 'bis', 'konto'] as const) {
    const wert = f[name];
    if (wert) p.set(name, wert);
  }
  if (f.spur === 'anmeldungen' && f.ereignis) p.set('ereignis', f.ereignis);
  if (f.spur === 'zugangsaenderungen' && f.aktion) p.set('aktion', f.aktion);
  return p;
}

const anmeldeSpalten = spaltenFuer<AnmeldeEintrag>()([
  {
    key: 'zeitpunkt',
    title: 'Zeitpunkt',
    width: 170,
    zahl: true,
    render: (_, e) => <ZeitAnzeige wert={e.zeitpunkt} />,
  },
  {
    key: 'ereignis',
    title: 'Ereignis',
    etikett: 'Ereignis',
    width: 220,
    render: (_, e) => EREIGNIS_TEXT[e.ereignis],
  },
  {
    key: 'konto',
    title: 'Konto',
    etikett: 'Konto',
    mindestBreite: 180,
    render: (_, e) => e.benutzername ?? leer,
  },
  {
    key: 'anmeldeweg',
    title: 'Anmeldeweg',
    width: 140,
    render: (_, e) => anmeldewegText(e.provider),
  },
  {
    key: 'quelle',
    title: 'Quelle',
    etikett: 'Quelle',
    width: 170,
    zahl: true,
    render: (_, e) => e.peer_ip ?? leer,
  },
]);

const ANMELDE_KARTE: Kartenplan<AnmeldeEintrag, (typeof anmeldeSpalten)[number]['key']> = {
  art: 'plan',
  titel: { spalte: 'zeitpunkt' },
  sekundaer: ['ereignis', 'konto', 'quelle'],
};

const aenderungsSpalten = spaltenFuer<Zugangsaenderung>()([
  {
    key: 'zeitpunkt',
    title: 'Zeitpunkt',
    width: 170,
    zahl: true,
    render: (_, e) => <ZeitAnzeige wert={e.zeitpunkt} />,
  },
  {
    key: 'aktion',
    title: 'Aktion',
    etikett: 'Aktion',
    width: 220,
    render: (_, e) => AKTION_TEXT[e.aktion],
  },
  {
    key: 'admin',
    title: 'Admin',
    etikett: 'Admin',
    width: 160,
    render: (_, e) => e.akteur_name ?? leer,
  },
  {
    key: 'ziel',
    title: 'Ziel',
    etikett: 'Ziel',
    width: 160,
    render: (_, e) => (e.ziel_benutzer_id == null ? anmeldewegText(e.ziel) : e.ziel),
  },
  {
    key: 'detail',
    title: 'Detail',
    mindestBreite: 200,
    render: (_, e) => e.detail ?? leer,
  },
  {
    key: 'quelle',
    title: 'Quelle',
    width: 170,
    zahl: true,
    render: (_, e) => e.peer_ip ?? leer,
  },
]);

const AENDERUNGS_KARTE: Kartenplan<Zugangsaenderung, (typeof aenderungsSpalten)[number]['key']> = {
  art: 'plan',
  titel: { spalte: 'zeitpunkt' },
  sekundaer: ['aktion', 'admin', 'ziel'],
};

/**
 * Filterleiste: Zeitraum, Konto, Ereignis bzw. Aktion. Zeiten und Auswahl melden sofort, das
 * Kontofeld entprellt (die Seite schreibt jede Meldung in die URL). Nur das Kontofeld hält
 * einen eigenen Stand; ihn setzt die Seite bei fremder Änderung der URL per `key` neu auf.
 */
function Filterleiste({
  filter,
  onChange,
}: {
  filter: SeitenFilter;
  onChange: (teil: Partial<SeitenFilter>) => void;
}) {
  const { token } = theme.useToken();
  const [konto, setKonto] = useState(filter.konto ?? '');
  const frist = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (frist.current) clearTimeout(frist.current);
    },
    [],
  );
  const benutzer = useQuery({ queryKey: globalKeys.benutzer(), queryFn: listeBenutzer });
  const kontoOptionen = useMemo(
    () => (benutzer.data ?? []).map((b) => ({ value: b.benutzername })),
    [benutzer.data],
  );

  const meldeKonto = (wert: string, sofort: boolean) => {
    setKonto(wert);
    if (frist.current) clearTimeout(frist.current);
    const melde = () => onChange({ konto: wert.trim() || undefined });
    if (sofort) melde();
    else frist.current = setTimeout(melde, ENTPRELLUNG_MS);
  };

  return (
    <Space wrap data-lfh="zugangsprotokoll-filter" style={{ marginBottom: token.marginSM }}>
      <ZeitpunktEingabe
        placeholder="von"
        aria-label="von"
        value={alsZeitpunkt(filter.von) ?? null}
        onChange={(d) => onChange({ von: d ? alsBackendZeit(d) : undefined })}
      />
      <ZeitpunktEingabe
        placeholder="bis"
        aria-label="bis"
        value={alsZeitpunkt(filter.bis) ?? null}
        onChange={(d) => onChange({ bis: d ? alsBackendZeit(d) : undefined })}
      />
      <AutoComplete
        aria-label="Konto"
        placeholder="Konto"
        allowClear
        value={konto}
        options={kontoOptionen}
        showSearch={teilwortSuche}
        onChange={(wert: string | undefined) => meldeKonto(wert ?? '', false)}
        onSelect={(wert?: string) => meldeKonto(wert ?? '', true)}
        style={{ width: 200 }}
      />
      {filter.spur === 'anmeldungen' ? (
        <Select<AnmeldeEreignis>
          aria-label="Ereignis"
          placeholder="alle Ereignisse"
          allowClear
          value={filter.ereignis}
          onChange={(ereignis) => onChange({ ereignis: ereignis ?? undefined })}
          options={Object.entries(EREIGNIS_TEXT).map(([value, label]) => ({
            value: value as AnmeldeEreignis,
            label,
          }))}
          style={{ width: 240 }}
        />
      ) : (
        <Select<AdminAktion>
          aria-label="Aktion"
          placeholder="alle Aktionen"
          allowClear
          value={filter.aktion}
          onChange={(aktion) => onChange({ aktion: aktion ?? undefined })}
          options={Object.entries(AKTION_TEXT).map(([value, label]) => ({
            value: value as AdminAktion,
            label,
          }))}
          style={{ width: 240 }}
        />
      )}
    </Space>
  );
}

/** Seitenkette einer Spur samt Stand für den Servermodus der `Datensicht`. */
interface Seitenkette<T> {
  query: UseInfiniteQueryResult<InfiniteData<T[]>>;
  stand: string;
}

function useSeitenkette<T extends { id: number }>(
  spur: ZugangsprotokollSpur,
  filter: Readonly<Record<string, string | undefined>>,
  laden: (vorId: number | undefined) => Promise<T[]>,
  aktiv: boolean,
): Seitenkette<T> {
  const schluessel = globalKeys.zugangsprotokollSeiten(spur, filter);
  const query = useInfiniteQuery({
    queryKey: schluessel,
    queryFn: ({ pageParam }) => laden(pageParam),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (letzte: T[]) => naechsteVorId(letzte),
    // Bis die Antwort auf einen Filterwechsel da ist, bleiben die alten Zeilen stehen.
    placeholderData: keepPreviousData,
    enabled: aktiv,
  });
  // Die alten Zeilen bis zur Antwort sind kein eigener Stand.
  const stand = query.isPlaceholderData ? 'vorläufig' : JSON.stringify(schluessel);
  return { query, stand };
}

/** Eine Spur: Fehler, Tabelle, „Ältere laden“. */
function SpurSicht<T extends { id: number }>({
  kette,
  bezeichnung,
  sicht,
}: {
  kette: Seitenkette<T>;
  bezeichnung: string;
  sicht: (zeilen: readonly T[], stand: string) => ReactNode;
}) {
  const { token } = theme.useToken();
  const { query, stand } = kette;
  const zeilen = useMemo(() => query.data?.pages.flat() ?? [], [query.data]);
  // Ohne Stand behauptet die Seite nichts über den Bestand: kein Leertext unter dem Fehler.
  if (query.isError && query.data === undefined) {
    return (
      <SeitenFehler
        text={`${bezeichnung} nicht ladbar`}
        ursache={query.error}
        onWiederholen={() => void query.refetch()}
      />
    );
  }
  return (
    <>
      {query.isRefetchError && <SeitenStandVeraltet onWiederholen={() => void query.refetch()} />}
      {sicht(zeilen, stand)}
      {query.hasNextPage && (
        <div style={{ textAlign: 'center', marginTop: token.margin }}>
          <Button onClick={() => void query.fetchNextPage()} loading={query.isFetchingNextPage}>
            Ältere laden
          </Button>
        </div>
      )}
    </>
  );
}

function ZugangsprotokollInhalt() {
  const { token } = theme.useToken();
  const { benutzer, laedt: authLaedt } = useAuth();
  const admin = istAdmin(benutzer);
  const [suchparameter, setSuchparameter] = useSearchParams();
  const filter = useMemo(() => parseZugangsprotokollFilter(suchparameter), [suchparameter]);
  const { spur } = filter;

  /**
   * Zählmarke, die die Filterleiste neu aufsetzt, wenn die URL von außen kommt (Menüeintrag,
   * Zurück-Taste) — sonst bliebe ein getipptes Konto über einer ungefilterten Liste stehen. Eine
   * eigene Änderung setzt sie nicht neu auf (der Remount nähme dem Kontofeld den Fokus). Muster
   * und Begründung der Folgerunde: `pages/EtbPage.tsx`.
   */
  const filterText = suchparameter.toString();
  const [filterMarke, setFilterMarke] = useState(0);
  const eigeneFilteraenderung = useRef(false);
  const vorigerFilterText = useRef(filterText);
  useEffect(() => {
    if (vorigerFilterText.current === filterText) return;
    vorigerFilterText.current = filterText;
    if (eigeneFilteraenderung.current) {
      eigeneFilteraenderung.current = false;
      return;
    }
    setFilterMarke((m) => m + 1);
  }, [filterText]);

  /** Der aktuelle Filter für die entprellte Kontomeldung, die sonst einen alten Stand sähe. */
  const filterRef = useRef(filter);
  useEffect(() => {
    filterRef.current = filter;
  }, [filter]);

  const setzeFilter = (teil: Partial<SeitenFilter>) => {
    const zusammen = { ...filterRef.current, ...teil };
    // Sofort nachführen: zwei Meldungen vor dem nächsten Render verlören sonst die erste.
    filterRef.current = zusammen;
    const neu = alsSuchparameter(zusammen);
    if (neu.toString() === vorigerFilterText.current) return;
    eigeneFilteraenderung.current = true;
    setSuchparameter(neu, { replace: true });
  };

  const gemeinsam = { von: filter.von, bis: filter.bis, konto: filter.konto };
  const anmeldeFilter = { ...gemeinsam, ereignis: filter.ereignis };
  const aenderungsFilter = { ...gemeinsam, aktion: filter.aktion };
  const anmeldungen = useSeitenkette<AnmeldeEintrag>(
    'anmeldungen',
    anmeldeFilter,
    (vorId) => ladeAnmeldungen(anmeldeFilter, vorId),
    admin && spur === 'anmeldungen',
  );
  const aenderungen = useSeitenkette<Zugangsaenderung>(
    'zugangsaenderungen',
    aenderungsFilter,
    (vorId) => ladeZugangsaenderungen(aenderungsFilter, vorId),
    admin && spur === 'zugangsaenderungen',
  );

  if (!authLaedt && !admin) return <Navigate to={defaultAdminPfad()} replace />;

  return (
    <AdminPage titel="Zugangsprotokoll">
      <Segmentleiste<ZugangsprotokollSpur>
        beschriftung="Spur"
        wert={spur}
        onWechsel={(neu) => setzeFilter({ spur: neu })}
        optionen={SPUREN}
        style={{ marginBottom: token.marginSM }}
      />
      <Filterleiste key={filterMarke} filter={filter} onChange={setzeFilter} />
      {spur === 'anmeldungen' ? (
        <SpurSicht
          kette={anmeldungen}
          bezeichnung="Anmeldungen"
          sicht={(zeilen, stand) => (
            <Datensicht
              key="anmeldungen"
              bezeichnung="Anmeldungen"
              form="tabelle"
              spalten={anmeldeSpalten}
              daten={zeilen}
              zeilenSchluessel="id"
              ladend={anmeldungen.query.isLoading}
              leerText="Keine Anmeldungen"
              karte={ANMELDE_KARTE}
              serverseitig={{ stand, onSuche: () => {}, onFilter: () => {} }}
            />
          )}
        />
      ) : (
        <SpurSicht
          kette={aenderungen}
          bezeichnung="Zugangsänderungen"
          sicht={(zeilen, stand) => (
            <Datensicht
              key="zugangsaenderungen"
              bezeichnung="Zugangsänderungen"
              form="tabelle"
              spalten={aenderungsSpalten}
              daten={zeilen}
              zeilenSchluessel="id"
              ladend={aenderungen.query.isLoading}
              leerText="Keine Zugangsänderungen"
              karte={AENDERUNGS_KARTE}
              serverseitig={{ stand, onSuche: () => {}, onFilter: () => {} }}
            />
          )}
        />
      )}
    </AdminPage>
  );
}

/** Zeiten in der Zone der Organisation, wie die Archivakte (LFH-692). */
export default function ZugangsprotokollPage() {
  return (
    <OrgAnzeigeProvider>
      <ZugangsprotokollInhalt />
    </OrgAnzeigeProvider>
  );
}
