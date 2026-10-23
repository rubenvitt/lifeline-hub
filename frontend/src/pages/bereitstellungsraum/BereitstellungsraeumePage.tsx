import { Breadcrumb, Button } from 'antd';
import type { Dayjs } from 'dayjs';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { bereitstellungsraumDetailPfad, einsaetzePfad, einsatzPfad } from '../../routing/deeplinks';
import { ladeEinsatz } from '../../api/einsaetze';
import { darfImEinsatzSchreiben } from '../../einsatz/schreibrecht';
import { listeBr } from '../../api/einsatzBereitstellungsraum';
import { listeEinheiten } from '../../api/einheiten';
import { einsatzKeys } from '../../api/queryKeys';
import type { BrListenEintrag, BrStatus } from '../../api/types';
import EinsatzSeite from '../../components/EinsatzSeite';
import StatusTag from '../../components/StatusTag';
import {
  SeitenFehler,
  SeitenLeer,
  SeitenSkeleton,
  SeitenStandVeraltet,
} from '../../components/SeitenZustand';
import { brStatus } from '../../theme/statusFarben';
import KatalogTabelle, { type KatalogSpalte } from '../../components/KatalogTabelle';
import { useListenGedaechtnis, type GedaechtnisSpalte } from '../../components/listenGedaechtnis';
import StaerkeAnzeige from '../../anzeige/StaerkeAnzeige';
import { staerkeImRaum } from '../../bereitstellungsraum/brZahlen';
import { useUhr } from '../../abloesung/useUhr';
import { dauerText } from '../../kraefte/zeitachse';
import { wartezeitMinuten } from './brBelegungKern';
import BrAnlegenDrawer from './BrAnlegenDrawer';
import { KennungsLink } from '../../components/kennungsLink';
import { useRollen } from '../../components/instrument';
import { modulName } from '../../einsatz/modulRegistry';

/** Status in der Reihenfolge des Lebenslaufs (geplant → aktiv → aufgelöst), nicht nach Alphabet. */
const STATUS_FOLGE = Object.keys(brStatus) as BrStatus[];
const STATUS_FILTER = STATUS_FOLGE.map((s) => ({ text: brStatus[s].label, value: s }));

/** Was das Gedächtnis von den Spalten wissen muss; die Spalten selbst hängen an Daten und Uhr. */
const GEDAECHTNIS_SPALTEN: readonly GedaechtnisSpalte[] = [
  { key: 'bezeichnung', sorter: true },
  { key: 'status', sorter: true, filters: STATUS_FILTER },
  { key: 'standort', sorter: true },
  { key: 'staerke', sorter: true },
  { key: 'fahrzeuge', sorter: true },
  { key: 'einheiten', sorter: true },
  { key: 'wartezeit', sorter: true },
];
/** Die Abschnitte stehen erst mit den Räumen fest (Filterwerte aus `abschnitt_name`). */
const GEDAECHTNIS_AUS_DATEN: readonly string[] = ['abschnitt'];

/** Kräfte im Raum als eine Zahl für die Sortierung; unvollständig und leer stehen unten. */
function staerkeSumme(br: BrListenEintrag, einheiten: Parameters<typeof staerkeImRaum>[1]): number {
  const { staerke, unvollstaendig } = staerkeImRaum(br.einheit_ids, einheiten);
  if (unvollstaendig || staerke == null) return -1;
  return staerke.fuehrer + staerke.unterfuehrer + staerke.mannschaft;
}

function wartezeitSortWert(br: BrListenEintrag, jetzt: Dayjs): number {
  const seit = br.belegung.laengste_seit_at;
  return seit ? wartezeitMinuten(seit, jetzt) : -1;
}

export default function BereitstellungsraeumePage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  /**
   * Sortierung und Kopffilter stehen in der Adresse (LLH-1096, `components/listenGedaechtnis.ts`);
   * der Hook gehört der Seite und steht vor jedem frühen Ausstieg. Ohne Vorgabe: unsortiert steht
   * die Liste in der Reihenfolge des Servers wie bisher.
   */
  const gedaechtnis = useListenGedaechtnis('bereitstellungsraeume', GEDAECHTNIS_SPALTEN, {
    einsatzId,
    ausDaten: GEDAECHTNIS_AUS_DATEN,
  });
  const navigate = useNavigate();

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const brQuery = useQuery({
    queryKey: einsatzKeys.br(einsatzId),
    queryFn: () => listeBr(einsatzId),
  });
  // Für die Stärke im Raum (LLH-1095 D13). Ohne Freigabe Einheiten (403) oder bei einem Fehler
  // bleibt `data` leer, und „Stärke“ zeigt „—“ wie die Detailseite.
  const einheitenQuery = useQuery({
    queryKey: einsatzKeys.einheiten(einsatzId),
    queryFn: () => listeEinheiten(einsatzId),
  });
  const jetzt = useUhr(60_000);
  const { rollen } = useRollen();

  const [anlegen, setAnlegen] = useState(false);

  const schreibgeschuetzt = !darfImEinsatzSchreiben(einsatzQuery.data);

  // Schnellaktion: ?neu=1 öffnet den Anlege-Drawer (Sprungpalette, LFH-506). Gelesen auf der
  // LISTEN-Route — `BereitstellungsraeumeDefault` am baren Modulpfad liest den Parameter nicht,
  // deshalb zeigt `bereitstellungsraeumeListePfad` hierher. Warten bis der Einsatz geladen ist;
  // Param immer löschen, Drawer nur bei Schreibrecht.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    if (searchParams.get('neu') !== '1') return;
    if (einsatzQuery.isLoading) return;
    if (!schreibgeschuetzt) setAnlegen(true);
    const naechste = new URLSearchParams(searchParams);
    naechste.delete('neu');
    setSearchParams(naechste, { replace: true });
  }, [searchParams, setSearchParams, einsatzQuery.isLoading, schreibgeschuetzt]);

  // Filterwerte Abschnitt aus den geladenen Räumen, stabil über einen Namensschlüssel.
  const abschnittSchluessel = [
    ...new Set(
      (brQuery.data ?? []).flatMap((br) => (br.abschnitt_name ? [br.abschnitt_name] : [])),
    ),
  ]
    .sort((a, b) => a.localeCompare(b, 'de'))
    .join('\u0000');
  const abschnittFilter = useMemo(
    () =>
      abschnittSchluessel === ''
        ? []
        : abschnittSchluessel.split('\u0000').map((name) => ({ text: name, value: name })),
    [abschnittSchluessel],
  );

  // Spalten der Belegung (LLH-1095 D13, Spec `bereitstellungsraum-belegung`, „Liste zeigt die
  // Belegung“): dieselben Werte wie die Detailseite — Fahrzeuge, Einheiten und längste Wartezeit
  // aus `belegung` des Servers, die Stärke nur über `staerkeImRaum`. Abschnitt und Standort sind
  // abwählbar und fallen unter `md` weg (Zähler im Schalter, Kriterium 14).
  //
  // Sortieren und Filtern (LLH-1096, Spec `tabellen-sortieren-filtern`): jede Spalte sortiert,
  // Status und Abschnitt sind Wertelisten und filtern. Standort ist Freitext, die Zahlen sind
  // keine Werteliste: sortierbar, ohne Filter.
  const spalten: KatalogSpalte<BrListenEintrag>[] = [
    {
      key: 'bezeichnung',
      title: 'Bezeichnung',
      dataIndex: 'bezeichnung',
      sorter: (a, b) => a.bezeichnung.localeCompare(b.bezeichnung, 'de'),
      render: (b: string, br) => (
        <KennungsLink to={bereitstellungsraumDetailPfad(einsatzId, br.id)}>{b}</KennungsLink>
      ),
    },
    {
      key: 'status',
      title: 'Status',
      dataIndex: 'status',
      immerSichtbar: true,
      sorter: (a, b) => STATUS_FOLGE.indexOf(a.status) - STATUS_FOLGE.indexOf(b.status),
      filters: STATUS_FILTER,
      onFilter: (wert, br) => br.status === wert,
      render: (s: BrStatus) => <StatusTag darstellung={brStatus[s]} />,
    },
    {
      key: 'abschnitt',
      title: 'Abschnitt',
      dataIndex: 'abschnitt_name',
      abBreite: 'md',
      sorter: (a, b) => (a.abschnitt_name ?? '').localeCompare(b.abschnitt_name ?? '', 'de'),
      filters: abschnittFilter.length > 0 ? abschnittFilter : undefined,
      onFilter: (wert, br) => br.abschnitt_name === wert,
      render: (a: string | null | undefined) => a ?? '—',
    },
    {
      key: 'standort',
      title: 'Standort',
      dataIndex: 'standort',
      abBreite: 'md',
      sorter: (a, b) => (a.standort ?? '').localeCompare(b.standort ?? '', 'de'),
      render: (s: string | null | undefined) => s ?? '—',
    },
    {
      key: 'staerke',
      title: 'Stärke',
      immerSichtbar: true,
      zahl: true,
      align: 'right',
      sorter: (a, b) => staerkeSumme(a, einheitenQuery.data) - staerkeSumme(b, einheitenQuery.data),
      render: (_: unknown, br) => {
        const { staerke, unvollstaendig } = staerkeImRaum(br.einheit_ids, einheitenQuery.data);
        // Der Grund steht sichtbar an der Zelle wie auf der Detailseite (Ton achtung), nie nur
        // als Tooltip: sonst sähe „unvollständig“ aus wie ein leerer Raum (D1, Touch).
        return unvollstaendig ? (
          <span data-lfh="br-staerke-unvollstaendig" style={{ color: rollen.achtungText }}>
            — unvollständig
          </span>
        ) : (
          <StaerkeAnzeige wert={staerke} />
        );
      },
    },
    {
      key: 'fahrzeuge',
      title: 'Fahrzeuge',
      immerSichtbar: true,
      zahl: true,
      align: 'right',
      sorter: (a, b) => a.belegung.fahrzeuge - b.belegung.fahrzeuge,
      render: (_: unknown, br) => br.belegung.fahrzeuge,
    },
    {
      key: 'einheiten',
      title: 'Einheiten',
      immerSichtbar: true,
      zahl: true,
      align: 'right',
      sorter: (a, b) => a.belegung.einheiten - b.belegung.einheiten,
      render: (_: unknown, br) => br.belegung.einheiten,
    },
    {
      key: 'wartezeit',
      title: 'Längste Wartezeit',
      immerSichtbar: true,
      zahl: true,
      align: 'right',
      // Ohne wartende Kraft zählt die Wartezeit als −1: aufsteigend oben, absteigend unten.
      sorter: (a, b) => wartezeitSortWert(a, jetzt) - wartezeitSortWert(b, jetzt),
      render: (_: unknown, br) => {
        const seit = br.belegung.laengste_seit_at;
        return seit ? dauerText(wartezeitMinuten(seit, jetzt)) : '—';
      },
    },
  ];

  // Zwei Ebenen: der Seitenzustand hängt nur an `einsatzQuery` (Breadcrumb, Schreibrecht) und
  // rechtfertigt einen Frühausstieg. Der Zustand von `brQuery` gehört an die Stelle der Liste
  // (unten), nicht vor die ganze Seite.
  if (einsatzQuery.isLoading) return <SeitenSkeleton />;
  if (einsatzQuery.error) {
    return (
      <SeitenFehler
        text="Einsatz konnte nicht geladen werden"
        ursache={einsatzQuery.error}
        onWiederholen={() => void einsatzQuery.refetch()}
      />
    );
  }

  const alle = brQuery.data ?? [];
  const sichtbar = alle.filter((br) => !br.storniert_at);

  /**
   * Ohne Zeilen im Zwischenspeicher ersetzt der Fehler die Tabelle, sonst behauptete der Leertext
   * eine leere Lage. Mit Zeilen bleiben sie stehen und bekommen ein Banner — sie sind echt, nur
   * womöglich alt.
   *
   * Gemessen an `alle`, nicht an `sichtbar` — dieselbe Achse wie in `TierePage`/`SchaedenPage`.
   * Folge: sind alle Räume storniert und scheitert die Aktualisierung, steht das Banner über einer
   * Tabelle mit Leertext. Das ist ehrlich — der Bestand ist leer, nur womöglich veraltet.
   */
  const listeGescheitert = brQuery.isError && alle.length === 0;
  const standVeraltet = brQuery.isError && alle.length > 0;

  return (
    <EinsatzSeite
      titel={modulName('bereitstellungsraeume')}
      dataUpdatedAt={brQuery.dataUpdatedAt}
      meta={brQuery.isSuccess ? `${alle.length} Räume` : undefined}

      breadcrumb={
        <Breadcrumb
          items={[
            { title: <Link to={einsaetzePfad()}>Einsätze</Link> },
            { title: <Link to={einsatzPfad(einsatzId)}>{einsatzQuery.data?.bezeichnung}</Link> },
            { title: modulName('bereitstellungsraeume') },
          ]}
        />
      }
      aktionen={
        <Button type="primary" disabled={schreibgeschuetzt} onClick={() => setAnlegen(true)}>
          Neu
        </Button>
      }
      // Zweiter Bedienweg auf die Primäraktion, mit demselben Rechte-Riegel wie der Knopf.
      neueZeile={schreibgeschuetzt ? undefined : () => setAnlegen(true)}
    >
      {/* Der Fehler tauscht die Tabelle aus: `Datensicht` führt den Kartenzweig an `Liste`,
          deren Vertrag keinen Fehlerbegriff kennt — ein Prop am Tabellen-Primitiv wirkte nur in
          einer Form. */}
      {listeGescheitert ? (
        <SeitenFehler
          text="Bereitstellungsräume konnten nicht geladen werden"
          ursache={brQuery.error}
          onWiederholen={() => void brQuery.refetch()}
        />
      ) : (
        <>
          {standVeraltet && <SeitenStandVeraltet onWiederholen={() => void brQuery.refetch()} />}
          {/* `!isLoading` statt `isSuccess`: scheitert eine nachfolgende Aktualisierung, setzt
              react-query `status` auf `'error'`, die (leeren) Zeilen aus dem Cache gelten aber
              weiter. */}
          {!brQuery.isLoading && sichtbar.length === 0 && (
            <SeitenLeer
              titel="Noch keine Bereitstellungsräume erfasst"
              aktion={
                schreibgeschuetzt
                  ? undefined
                  : { label: 'Ersten BR anlegen', onClick: () => setAnlegen(true) }
              }
            />
          )}
          {(sichtbar.length > 0 || brQuery.isLoading) && (
            <KatalogTabelle<BrListenEintrag>
              rowKey="id"
              loading={brQuery.isLoading}
              dataSource={sichtbar}
              columns={spalten}
              gedaechtnis={gedaechtnis}
              mehrzahl="Räumen"
              spaltenSchalter={{ bezeichnung: modulName('bereitstellungsraeume') }}
              size="middle"
              pagination={false}
              locale={{ emptyText: 'Noch keine Bereitstellungsräume erfasst' }}
            />
          )}
        </>
      )}

      <BrAnlegenDrawer
        einsatzId={einsatzId}
        open={anlegen}
        onClose={() => setAnlegen(false)}
        onAngelegt={(br) => navigate(bereitstellungsraumDetailPfad(einsatzId, br.id))}
      />
    </EinsatzSeite>
  );
}
