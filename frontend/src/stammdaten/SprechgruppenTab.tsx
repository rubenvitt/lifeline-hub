import { App, Button, Popconfirm, Space, type TableColumnsType } from 'antd';
import AdminPage from '../components/AdminPage';
import { StatusChip, monoStil } from '../components/instrument';
import { SeitenHinweise } from '../components/SpeicherHinweis';
import KatalogTabelle from '../components/KatalogTabelle';
import { SeitenFehler } from '../components/SeitenZustand';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { fehlerText } from '../api/client';
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
    onError: (e) => message.error(fehlerText(e)),
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
      // Eine Betriebsart ist eine KENNUNG, kein Zustand — Mono statt einer Etikettfarbe, die
      // TMO und DMO Bedeutungen andichtete (blau = Bedienung, orange = Achtung).
      render: (ba: string) => <span style={monoStil(12, 500)}>{ba}</span>,
    },
    {
      title: 'Hinweis',
      dataIndex: 'hinweis',
      key: 'hinweis',
      /**
       * Die einzige Freitextspalte — ungekürzt trieb sie die Zeilenhöhe. `showTitle` hält den vollen
       * Wert erreichbar, und der Hinweis steht namentlich im Suchplatzhalter. Gekappt wird an der
       * ZELLE, nicht über eine Spaltenbreite: unter `table-layout: auto`, das `KatalogTabelle` mit
       * `scroll={{ x: 'max-content' }}` erzwingt, ist eine Spaltenbreite wirkungslos (Herleitung in
       * `karten/OnlineQuellenVerwaltung.tsx`).
       */
      ellipsis: { showTitle: true },
      onCell: () => ({ style: { maxWidth: 240 } }),
      render: (h: string | null) => h ?? '—',
    },
    {
      title: 'Aktiv',
      key: 'aktiv',
      // Zweite Filterachse: der Tab lädt bewusst auch die deaktivierten (`listeSprechgruppen(false)`);
      // wer nur den Bestand im Funkbetrieb sehen will, blendet sie hier weg.
      //
      // OHNE `dataIndex`: `onFilter` und `render` bekommen den ganzen Datensatz, ein Bezug trüge nur
      // den Drahtwert in den Suchkorpus — „al" träfe jede inaktive Zeile („false"), „ru" jede
      // aktive („true"). Bauform wie die Status-Spalte in `pages/BenutzerPage.tsx`.
      filters: [
        { text: 'Aktiv', value: true },
        { text: 'Inaktiv', value: false },
      ],
      onFilter: (wert, sg) => sg.aktiv === wert,
      // Status als getönte Fläche mit Wort, nicht als antd-Farbetikett.
      render: (_, sg) =>
        sg.aktiv ? (
          <StatusChip ton="normal" wort="Aktiv" />
        ) : (
          <StatusChip ton="neutral" wort="Inaktiv" />
        ),
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
          Sprechgruppe anlegen
        </Button>
      }
      hinweis={<SeitenHinweise rechteFehlt={!istAdmin} rechteText={STAMMDATEN_RECHTE_TEXT} />}
    >
      {/* Der Fehler tauscht die Tabelle aus (LFH-331): `Datensicht` führt den Kartenzweig an
         `Liste`, und `ListeProps` kennt keinen Fehlerbegriff. Ohne diese Weiche behauptete „Noch
         keine Sprechgruppen" einen leeren Katalog, wenn bloß die Verbindung abgerissen ist. */}
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
