import { App, Button, Popconfirm, Space, Tag, type TableColumnsType } from 'antd';
import AdminPage from '../components/AdminPage';
import { SeitenHinweise } from '../components/SpeicherHinweis';
import KatalogTabelle from '../components/KatalogTabelle';
import { SeitenFehler } from '../components/SeitenZustand';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';
import { deaktiviereSprechgruppe, listeSprechgruppen } from '../api/sprechgruppen';
import type { Sprechgruppe } from '../api/types';
import SprechgruppeFormModal from './SprechgruppeFormModal';
import { globalKeys } from '../api/queryKeys';
import { STAMMDATEN_RECHTE_TEXT } from './rechteText';

export default function SprechgruppenTab() {
  const { benutzer } = useAuth();
  const istAdmin = benutzer?.system_rolle === 'admin';
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [modalOffen, setModalOffen] = useState(false);
  const [bearbeite, setBearbeite] = useState<Sprechgruppe | null>(null);

  const sprechgruppenQuery = useQuery({
    queryKey: globalKeys.sprechgruppenAlle(),
    queryFn: () => listeSprechgruppen(false),
  });

  const deaktivierenMutation = useMutation({
    mutationFn: (id: number) => deaktiviereSprechgruppe(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: globalKeys.sprechgruppenAlle() }),
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen'),
  });

  const spalten: TableColumnsType<Sprechgruppe> = [
    {
      title: 'Bezeichnung',
      dataIndex: 'bezeichnung',
      key: 'bezeichnung',
      // Leitspalte: an der Bezeichnung sucht ein Mensch die Sprechgruppe. `numeric: true`, weil
      // die Bezeichner mit Zahlen beginnen (412_F_DRK) und ein rein zeichenweiser Vergleich
      // 42_… vor 412_… einsortierte. Ohne `defaultSortOrder` — die Voreinstellung bleibt die
      // fachliche Reihenfolge des Backends (`sprechgruppe/repo.rs`:
      // ORDER BY betriebsart, sortier, bezeichnung), die TMO und DMO gruppiert hält.
      sorter: (a, b) => a.bezeichnung.localeCompare(b.bezeichnung, 'de', { numeric: true }),
    },
    {
      title: 'Betriebsart',
      dataIndex: 'betriebsart',
      key: 'betriebsart',
      // Die Filterwerte stehen fest aus dem Wire-Enum `Betriebsart` ("TMO" | "DMO") und werden
      // NICHT aus den geladenen Zeilen abgeleitet: sonst verschwände genau der Filterwert aus
      // der Liste, dessen Zeilen man gerade sucht, weil keine geladene Zeile ihn trägt.
      filters: [
        { text: 'TMO', value: 'TMO' },
        { text: 'DMO', value: 'DMO' },
      ],
      onFilter: (wert, sg) => sg.betriebsart === wert,
      render: (ba: string) => <Tag color={ba === 'TMO' ? 'blue' : 'orange'}>{ba}</Tag>,
    },
    {
      title: 'Hinweis',
      dataIndex: 'hinweis',
      key: 'hinweis',
      /**
       * Die einzige Freitextspalte dieser Tabelle — sie trägt Belegungshinweise und trieb
       * ungekürzt die Zeilenhöhe (Befund N13). `showTitle` hält den vollen Wert erreichbar,
       * und der Bezug bleibt: der Hinweis steht namentlich im Suchplatzhalter.
       * Gekappt wird an der ZELLE, nicht über eine Spaltenbreite — die im Browser gemessene
       * Begründung steht in `karten/OnlineQuellenVerwaltung.tsx`: unter `table-layout: auto`,
       * das `KatalogTabelle` mit `scroll={{ x: 'max-content' }}` erzwingt, ist eine
       * Spaltenbreite wirkungslos.
       */
      ellipsis: { showTitle: true },
      onCell: () => ({ style: { maxWidth: 240 } }),
      render: (h: string | null) => h ?? '—',
    },
    {
      title: 'Aktiv',
      key: 'aktiv',
      // Zweite Filterachse: der Tab lädt bewusst auch die deaktivierten (`listeSprechgruppen(false)`),
      // wer nur den Bestand im Funkbetrieb sehen will, blendet sie hier weg.
      //
      // Bewusst OHNE `dataIndex` — `onFilter` und `render` bekommen ohnehin den ganzen Datensatz,
      // ein Bezug trüge hier nur den Drahtwert in den Suchkorpus des Primitivs, das die ROHWERTE
      // liest. Gemessen: mit `dataIndex: 'aktiv'` traf die Eingabe „al" jede INAKTIVE Zeile
      // („false") und „ru" jede aktive („true") — Zufallstreffer, die niemand tippen wollte.
      // Gleiche Bauform wie die Status-Spalte in `pages/BenutzerPage.tsx`.
      filters: [
        { text: 'Aktiv', value: true },
        { text: 'Inaktiv', value: false },
      ],
      onFilter: (wert, sg) => sg.aktiv === wert,
      render: (_, sg) => (sg.aktiv ? <Tag color="green">Aktiv</Tag> : <Tag>Inaktiv</Tag>),
    },
    ...(istAdmin
      ? ([
          {
            title: 'Aktionen',
            key: 'aktionen',
            render: (_, sg: Sprechgruppe) => (
              <Space size="middle">
                <Button
                  onClick={() => {
                    setBearbeite(sg);
                    setModalOffen(true);
                  }}
                >
                  Bearbeiten
                </Button>
                {sg.aktiv && (
                  <Popconfirm
                    title="Sprechgruppe deaktivieren?"
                    okButtonProps={{ danger: true }}
                    onConfirm={() => deaktivierenMutation.mutate(sg.id)}
                  >
                    <Button danger>Deaktivieren</Button>
                  </Popconfirm>
                )}
              </Space>
            ),
          },
        ] as TableColumnsType<Sprechgruppe>)
      : []),
  ];

  return (
    <AdminPage
      titel="Sprechgruppen"
      aktionen={
        /* Der Knopf VERSCHWINDET nicht mehr, wenn das Recht fehlt (M16, LFH-345 · C10) —
           er steht gesperrt, den Grund nennt der Hinweis darunter. Ein fehlender Knopf ist
           von „diese Seite kann das gar nicht" nicht zu unterscheiden; „ausgegraut" allein
           wäre eine Ein-Kanal-Aussage (Grau ist eine Farbe, WCAG 1.4.1).
           Der Slot liegt AUSSERHALB jedes `<form>` (Dateikopf `AdminPage`) — hier steht
           deshalb nie ein `htmlType="submit"`, sondern immer ein Modal-Öffner. */
        <Button
          type="primary"
          disabled={!istAdmin}
          onClick={() => {
            setBearbeite(null);
            setModalOffen(true);
          }}
        >
          Sprechgruppe anlegen
        </Button>
      }
      hinweis={<SeitenHinweise rechteFehlt={!istAdmin} rechteText={STAMMDATEN_RECHTE_TEXT} />}
    >
      {/* Der Fehler tauscht die Tabelle aus, statt durch sie hindurchgereicht zu werden
          (LFH-331 · B3): `Datensicht` führt den Kartenzweig an `Liste`, und `ListeProps`
          kennt keinen Fehlerbegriff — ein Prop am Tabellen-Primitiv wirkte nur in einer
          der beiden Formen. Ohne diese Weiche behauptet „Noch keine Sprechgruppen" auch
          dann einen leeren Katalog, wenn bloß die Verbindung abgerissen ist. */}
      {sprechgruppenQuery.isError ? (
        <SeitenFehler
          text="Sprechgruppen konnten nicht geladen werden"
          ursache={sprechgruppenQuery.error}
          onWiederholen={() => void sprechgruppenQuery.refetch()}
        />
      ) : (
        <KatalogTabelle
          rowKey="id"
          loading={sprechgruppenQuery.isLoading}
          dataSource={sprechgruppenQuery.data ?? []}
          columns={spalten}
          locale={{ emptyText: 'Noch keine Sprechgruppen' }}
          suche={{ platzhalter: 'Bezeichnung, Betriebsart oder Hinweis' }}
        />
      )}
      <SprechgruppeFormModal
        offen={modalOffen}
        sprechgruppe={bearbeite}
        onClose={() => setModalOffen(false)}
      />
    </AdminPage>
  );
}
