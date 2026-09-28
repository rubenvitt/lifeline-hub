import { App, Button, Popconfirm, Space, type TableColumnsType } from 'antd';
import { Link } from 'react-router';
import AdminPage from '../components/AdminPage';
import { StatusChip, monoStil } from '../components/instrument';
import { SeitenHinweise } from '../components/SpeicherHinweis';
import KatalogTabelle from '../components/KatalogTabelle';
import { SeitenFehler } from '../components/SeitenZustand';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';
import { ladeFahrzeugVorschlaege, listeFahrzeuge, setzeDienststatus } from '../api/fahrzeuge';
import type { Fahrzeug } from '../api/types';
import FahrzeugFormModal from './FahrzeugFormModal';
import { globalKeys } from '../api/queryKeys';
import { STAMMDATEN_RECHTE_TEXT } from './rechteText';
import { fahrzeugDetailPfad } from './stammdatenDetail';

function staerkeText(f: Fahrzeug): string {
  if (!f.staerke) return '—';
  const { fuehrer, unterfuehrer, mannschaft } = f.staerke;
  return `${fuehrer}/${unterfuehrer}/${mannschaft}//${fuehrer + unterfuehrer + mannschaft}`;
}

export default function FahrzeugeTab() {
  const { benutzer } = useAuth();
  const istAdmin = benutzer?.system_rolle === 'admin';
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [modalOffen, setModalOffen] = useState(false);
  const [bearbeite, setBearbeite] = useState<Fahrzeug | null>(null);

  const fahrzeugeQuery = useQuery({
    queryKey: globalKeys.fahrzeugeListe('alle'),
    queryFn: () => listeFahrzeuge(false),
  });
  const vorschlaegeQuery = useQuery({
    queryKey: globalKeys.fahrzeugVorschlaege(),
    queryFn: ladeFahrzeugVorschlaege,
  });

  const dienststatusMutation = useMutation({
    mutationFn: (v: { id: number; inDienst: boolean }) => setzeDienststatus(v.id, v.inDienst),
    onSuccess: () => qc.invalidateQueries({ queryKey: globalKeys.fahrzeuge() }),
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen'),
  });

  const spalten: TableColumnsType<Fahrzeug> = [
    {
      title: 'Funkrufname',
      dataIndex: 'funkrufname',
      key: 'funkrufname',
      /**
       * Leitspalte: am Funkrufname wird ein Fahrzeug gesucht, nie an der DB-Kennung — dieselbe
       * Spalte, die `KatalogTabelle` als menschenlesbare Kennung fixiert.
       *
       * `numeric: true`, weil Funkrufnamen durchnummeriert sind; rein lexikografisch stünde
       * „Florian 10" vor „Florian 2" [abgeleitet].
       *
       * KEIN `defaultSortOrder`: das Backend liefert bereits `ORDER BY funkrufname`. Die Sortierung
       * ist ein Angebot — absteigend, und mit `de`-Kollation statt SQLites BINARY-Vergleich.
       */
      sorter: (a, b) => a.funkrufname.localeCompare(b.funkrufname, 'de', { numeric: true }),
      /**
       * Die Leitspalte führt auf die Detailseite. Ein Anker-Riegel ist NICHT nötig: `KatalogTabelle`
       * kennt kein `onZeileKlick` — das betrifft nur `Datensicht`, wo Zeilenklick und Link
       * gleichzeitig feuern könnten.
       */
      render: (_, f) => (
        <Link to={fahrzeugDetailPfad(f.id)} style={monoStil(13)}>
          {f.funkrufname}
        </Link>
      ),
    },
    { title: 'Typ', dataIndex: 'fahrzeugtyp', key: 'fahrzeugtyp', render: (t) => t ?? '—' },
    { title: 'Träger', dataIndex: 'traegerorganisation', key: 'traeger', render: (t) => t ?? '—' },
    {
      title: 'Kennzeichen',
      dataIndex: 'kennzeichen',
      key: 'kennzeichen',
      render: (t) => (t ? <span style={monoStil(12)}>{t}</span> : '—'),
    },
    {
      title: 'Stärke',
      key: 'staerke',
      render: (_, f) => <span style={monoStil(12)}>{staerkeText(f)}</span>,
    },
    {
      title: 'Status',
      key: 'dienststatus',
      /**
       * Die einzige geschlossene Achse dieser Tabelle (`in_dienst | ausser_dienst`) und die Frage,
       * die im Einsatz zuerst gestellt wird. Typ und Träger sind Freitext — die bedient die Suche
       * besser als eine Auswahlliste, die mit dem Bestand driftet.
       *
       * OHNE `dataIndex`: `onFilter` liest den Datensatz selbst, und ein Bezug zöge den Drahtwert
       * `in_dienst` in die Freitextsuche — ein Wort, das niemand tippt, weil die Zelle „in Dienst"
       * zeigt.
       *
       * `String(wert)`: antd typisiert das Filterargument als `React.Key | boolean`.
       */
      filters: [
        { text: 'in Dienst', value: 'in_dienst' },
        { text: 'außer Dienst', value: 'ausser_dienst' },
      ],
      onFilter: (wert, f) => f.dienststatus === String(wert),
      render: (_, f) =>
        f.dienststatus === 'in_dienst' ? (
          <StatusChip ton="normal" wort="in Dienst" />
        ) : (
          <StatusChip ton="neutral" wort="außer Dienst" />
        ),
    },
    ...(istAdmin
      ? ([
          {
            title: 'Aktionen',
            key: 'aktionen',
            render: (_, f: Fahrzeug) => {
              /**
               * Eine laufende Mutation gehört GENAU EINER Zeile (LFH-346): eine Sperre an
               * `dienststatusMutation.isPending` legte die ganze Tabelle still.
               *
               * Der Riegel gegen ein zweites Absenden DERSELBEN Zeile sitzt im `onConfirm`/`onClick`: ein
               * Klick auf eine ANDERE Zeile ist die nächste Aufgabe, kein Doppelklick.
               *
               * Er hält bewusst WENIGER: EIN `useMutation`-Observer meldet nur den JÜNGSTEN Aufruf, die
               * Marke WANDERT also. Nach A → B → A ist A wieder klickbar, obwohl seine erste Anfrage noch
               * läuft. Unschädlich, weil der Endpunkt einen Status SETZT (idempotent). Enger ginge es nur
               * mit einem Zustand je Zeile.
               */
              const laeuft =
                dienststatusMutation.isPending && dienststatusMutation.variables?.id === f.id;
              return (
                <Space size="middle">
                  <Button
                    disabled={laeuft}
                    onClick={() => {
                      setBearbeite(f);
                      setModalOffen(true);
                    }}
                  >
                    Bearbeiten
                  </Button>
                  {f.dienststatus === 'in_dienst' ? (
                    <Popconfirm
                      title="Außer Dienst stellen?"
                      disabled={laeuft}
                      okButtonProps={{ danger: true }}
                      onConfirm={() => {
                        if (!laeuft) {
                          dienststatusMutation.mutate({ id: f.id, inDienst: false });
                        }
                      }}
                    >
                      <Button danger loading={laeuft} disabled={laeuft}>
                        Außer Dienst
                      </Button>
                    </Popconfirm>
                  ) : (
                    <Button
                      loading={laeuft}
                      disabled={laeuft}
                      onClick={() => {
                        if (!laeuft) {
                          dienststatusMutation.mutate({ id: f.id, inDienst: true });
                        }
                      }}
                    >
                      Wieder in Dienst
                    </Button>
                  )}
                </Space>
              );
            },
          },
        ] as TableColumnsType<Fahrzeug>)
      : []),
  ];

  return (
    <AdminPage
      titel="Fahrzeuge"
      aktionen={
        /* Der Knopf steht ohne Recht gesperrt, den Grund nennt der Hinweis (LFH-345): ein fehlender
           Knopf ist von „diese Seite kann das gar nicht" nicht zu unterscheiden, „ausgegraut" allein
           wäre eine Ein-Kanal-Aussage (WCAG 1.4.1). Der Slot liegt AUSSERHALB jedes `<form>`
           (`AdminPage`) — hier steht deshalb ein Modal-Öffner, nie ein `htmlType="submit"`. */
        <Button
          type="primary"
          disabled={!istAdmin}
          onClick={() => {
            setBearbeite(null);
            setModalOffen(true);
          }}
        >
          Fahrzeug anlegen
        </Button>
      }
      hinweis={<SeitenHinweise rechteFehlt={!istAdmin} rechteText={STAMMDATEN_RECHTE_TEXT} />}
    >
      {/* Der Fehler tauscht die Tabelle aus (LFH-331): `Datensicht` führt den Kartenzweig an
         `Liste`, und `ListeProps` kennt keinen Fehlerbegriff. Ohne diese Weiche behauptete „Noch
         keine Fahrzeuge" einen leeren Katalog, wenn bloß die Verbindung abgerissen ist. */}
      {fahrzeugeQuery.isError ? (
        <SeitenFehler
          text="Fahrzeuge konnten nicht geladen werden"
          ursache={fahrzeugeQuery.error}
          onWiederholen={() => void fahrzeugeQuery.refetch()}
        />
      ) : (
        <KatalogTabelle
          rowKey="id"
          loading={fahrzeugeQuery.isLoading}
          dataSource={fahrzeugeQuery.data ?? []}
          columns={spalten}
          locale={{ emptyText: 'Noch keine Fahrzeuge' }}
          // Durchsucht werden die vier Spalten mit Datenbezug (Funkrufname, Typ, Träger, Kennzeichen);
          // Stärke und Status sind render-only. Der Platzhalter nennt drei — die volle Aufzählung würde
          // im schmalen Feld abgeschnitten.
          suche={{ platzhalter: 'Funkrufname, Typ oder Kennzeichen' }}
        />
      )}
      <FahrzeugFormModal
        offen={modalOffen}
        fahrzeug={bearbeite}
        vorschlaege={
          vorschlaegeQuery.data ?? { fahrzeugtyp: [], traegerorganisation: [], standort: [] }
        }
        onClose={() => setModalOffen(false)}
      />
    </AdminPage>
  );
}
