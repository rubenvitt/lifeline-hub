import { App, Button, Popconfirm, Space, type TableColumnsType } from 'antd';
import AdminPage from '../components/AdminPage';
import { StatusChip, monoStil } from '../components/instrument';
import { SeitenHinweise } from '../components/SpeicherHinweis';
import KatalogTabelle from '../components/KatalogTabelle';
import { SeitenFehler } from '../components/SeitenZustand';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';
import { listeKategorien, listeMaterial, setzeDienststatus } from '../api/material';
import type { Material } from '../api/types';
import MaterialFormModal from './MaterialFormModal';
import { globalKeys } from '../api/queryKeys';
import { STAMMDATEN_RECHTE_TEXT } from './rechteText';

export default function MaterialTab() {
  const { benutzer } = useAuth();
  const istAdmin = benutzer?.system_rolle === 'admin';
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [modalOffen, setModalOffen] = useState(false);
  const [bearbeite, setBearbeite] = useState<Material | null>(null);

  const materialQuery = useQuery({
    queryKey: globalKeys.materialListe('alle'),
    queryFn: () => listeMaterial(false),
  });
  const kategorienQuery = useQuery({
    queryKey: globalKeys.materialKategorien(),
    queryFn: listeKategorien,
  });

  const dienststatusMutation = useMutation({
    mutationFn: (v: { id: number; inDienst: boolean }) => setzeDienststatus(v.id, v.inDienst),
    onSuccess: () => qc.invalidateQueries({ queryKey: globalKeys.material() }),
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen'),
  });

  const spalten: TableColumnsType<Material> = [
    {
      title: 'Bezeichnung',
      dataIndex: 'bezeichnung',
      key: 'bezeichnung',
      /**
       * Leitspalte: an der Bezeichnung wird ein Materialposten gesucht, nicht an der DB-Kennung —
       * dieselbe Spalte, die `KatalogTabelle` als menschenlesbare Kennung fixiert. `numeric: true`,
       * weil Bezeichnungen Größen tragen („B-Schlauch 5 m" vs. „… 20 m") [abgeleitet].
       *
       * KEIN `defaultSortOrder`: das Backend liefert bereits `ORDER BY bezeichnung`. Die Sortierung
       * ist ein Angebot — absteigend und mit `de`-Kollation statt SQLites BINARY-Vergleich.
       */
      sorter: (a, b) => a.bezeichnung.localeCompare(b.bezeichnung, 'de', { numeric: true }),
    },
    { title: 'Kategorie', dataIndex: 'kategorie', key: 'kategorie', render: (t) => t ?? '—' },
    {
      title: 'Bestandsnummer',
      dataIndex: 'bestandsnummer',
      key: 'bestandsnummer',
      render: (t) => (t ? <span style={monoStil(13)}>{t}</span> : '—'),
    },
    { title: 'Träger', dataIndex: 'traegerorganisation', key: 'traeger', render: (t) => t ?? '—' },
    {
      title: 'Status',
      key: 'dienststatus',
      /**
       * Gefiltert wird über den Dienststatus, nicht über die Kategorie: `Dienststatus` ist ein
       * geschlossenes Enum und beantwortet die Frage, die im Einsatz zuerst gestellt wird. Die
       * Kategorie ist mandantengepflegt — eine Filterliste daraus käme aus einer zweiten Abfrage
       * und könnte driften; sie hat einen `dataIndex` und wird von der Freitextsuche bedient.
       *
       * OHNE `dataIndex` (wie in `FahrzeugeTab`): ein gesetzter zöge den Drahtwert `in_dienst` in
       * die Suche. `String(wert)`, weil antd das Filterargument als `React.Key | boolean` typisiert.
       */
      filters: [
        { text: 'in Dienst', value: 'in_dienst' },
        { text: 'außer Dienst', value: 'ausser_dienst' },
      ],
      onFilter: (wert, m) => m.dienststatus === String(wert),
      render: (_, m) =>
        m.dienststatus === 'in_dienst' ? (
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
            render: (_, m: Material) => {
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
                dienststatusMutation.isPending && dienststatusMutation.variables?.id === m.id;
              return (
                <Space size="middle">
                  <Button
                    disabled={laeuft}
                    onClick={() => {
                      setBearbeite(m);
                      setModalOffen(true);
                    }}
                  >
                    Bearbeiten
                  </Button>
                  {m.dienststatus === 'in_dienst' ? (
                    <Popconfirm
                      title="Außer Dienst stellen?"
                      disabled={laeuft}
                      okButtonProps={{ danger: true }}
                      onConfirm={() => {
                        if (!laeuft) {
                          dienststatusMutation.mutate({ id: m.id, inDienst: false });
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
                          dienststatusMutation.mutate({ id: m.id, inDienst: true });
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
        ] as TableColumnsType<Material>)
      : []),
  ];

  return (
    <AdminPage
      titel="Material"
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
          Material anlegen
        </Button>
      }
      hinweis={<SeitenHinweise rechteFehlt={!istAdmin} rechteText={STAMMDATEN_RECHTE_TEXT} />}
    >
      {/* Der Fehler tauscht die Tabelle aus (LFH-331): `Datensicht` führt den Kartenzweig an
         `Liste`, und `ListeProps` kennt keinen Fehlerbegriff. Ohne diese Weiche behauptete „Noch
         kein Material" einen leeren Katalog, wenn bloß die Verbindung abgerissen ist. */}
      {materialQuery.isError ? (
        <SeitenFehler
          text="Material konnte nicht geladen werden"
          ursache={materialQuery.error}
          onWiederholen={() => void materialQuery.refetch()}
        />
      ) : (
        <KatalogTabelle
          rowKey="id"
          loading={materialQuery.isLoading}
          dataSource={materialQuery.data ?? []}
          columns={spalten}
          locale={{ emptyText: 'Noch kein Material' }}
          // Durchsucht werden die vier Spalten mit Datenbezug (Bezeichnung, Kategorie, Bestandsnummer,
          // Träger); die Statusspalte ist render-only. Der Platzhalter nennt zwei — die volle
          // Aufzählung würde im schmalen Feld abgeschnitten.
          suche={{ platzhalter: 'Bezeichnung oder Kategorie' }}
        />
      )}
      <MaterialFormModal
        offen={modalOffen}
        material={bearbeite}
        kategorien={kategorienQuery.data ?? []}
        onClose={() => setModalOffen(false)}
      />
    </AdminPage>
  );
}
