import { App, Button, Popconfirm, Space, Tag, Typography, theme, type TableColumnsType } from 'antd';
import AdminPage from '../components/AdminPage';
import { SeitenHinweise } from '../components/SpeicherHinweis';
import KatalogTabelle from '../components/KatalogTabelle';
import { SeitenFehler } from '../components/SeitenZustand';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';
import { deaktiviereBaustein, listeBausteine } from '../api/etbBaustein';
import type { EtbBaustein } from '../api/types';
import { etbTyp } from '../theme/statusFarben';
import EtbBausteinFormModal from './EtbBausteinFormModal';
import { globalKeys } from '../api/queryKeys';
import { STAMMDATEN_RECHTE_TEXT } from './rechteText';

export default function EtbBausteineTab() {
  const { benutzer } = useAuth();
  const istAdmin = benutzer?.system_rolle === 'admin';
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [modalOffen, setModalOffen] = useState(false);
  const [bearbeite, setBearbeite] = useState<EtbBaustein | null>(null);
  const { token } = theme.useToken();

  const query = useQuery({ queryKey: globalKeys.etbBausteine(), queryFn: listeBausteine });

  const deaktivieren = useMutation({
    mutationFn: (id: number) => deaktiviereBaustein(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: globalKeys.etbBausteine() }),
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Deaktivieren fehlgeschlagen'),
  });

  const spalten: TableColumnsType<EtbBaustein> = [
    {
      title: 'Baustein',
      dataIndex: 'label',
      key: 'baustein',
      /**
       * Leitspalte: an ihr sucht ein Mensch den Baustein. Kein `defaultSortOrder` — die
       * fachliche Reihenfolge ist `sortier` und kommt vom Server
       * (`src/etb_baustein/repo.rs:47` — `ORDER BY sortier, id`); sie bestimmt, in welcher
       * Folge die Bausteine im ETB angeboten werden, und bleibt deshalb der Einstieg.
       *
       * ZWEI ZEILEN, EINE ZELLE (LFH-346 · A4, Befund N13): Label und Inhalt gehören
       * zusammen gelesen („was fügt dieser Baustein ein?"), nicht verglichen — als zwei
       * Spalten nebeneinander zwangen sie den Blick zum Springen, und der ungekürzte Inhalt
       * trieb die Zeilenhöhe.
       *
       * `dataIndex: 'label'` BLEIBT stehen, und das ist die tragende Zeile dieser Spalte:
       * die Suche des Primitivs liest nur Spalten mit auflösbarem Datenbezug (Dateikopf
       * `KatalogTabelle`); ohne ihn fiele die Leitspalte ganz aus dem Suchkorpus. Der
       * Inhalt entsteht erst beim Rendern und trägt seither NICHT mehr bei — der
       * Suchplatzhalter sagt deshalb „Label" statt „Label oder Inhalt". Der enge Korpus ist
       * der bewusste Preis; ein Platzhalter, der mehr verspricht, als die Suche hält, wäre
       * teurer.
       *
       * Gekappt wird an der ZELLE, nicht über eine Spaltenbreite — die im Browser gemessene
       * Begründung steht in `karten/OnlineQuellenVerwaltung.tsx`: unter `table-layout: auto`,
       * das `KatalogTabelle` mit `scroll={{ x: 'max-content' }}` erzwingt, ist eine
       * Spaltenbreite wirkungslos. Einzeilig gekürzt wird über `Typography.Text` —
       * mehrzeilige Kürzung gibt es in antd 6 nur über `Paragraph` (LFH-369), und hier ist
       * einzeilig gewollt.
       */
      sorter: (a, b) => a.label.localeCompare(b.label, 'de'),
      onCell: () => ({ style: { maxWidth: 320 } }),
      render: (label: string, b: EtbBaustein) => (
        <>
          {/* Die Marke trägt die Testabfrage: der `textContent` der Zelle enthält seit der
              Vereinigung Label UND Inhalt, ein `td:first-child`-Griff läse beides. */}
          <div data-lfh="baustein-label" style={{ fontWeight: token.fontWeightStrong }}>
            {label}
          </div>
          <Typography.Text
            type="secondary"
            ellipsis={{ tooltip: b.inhalt }}
            style={{ display: 'block' }}
          >
            {b.inhalt}
          </Typography.Text>
        </>
      ),
    },
    {
      title: 'Typ',
      dataIndex: 'typ',
      key: 'typ',
      /**
       * Werte aus derselben Quelle wie die Anzeige (`theme/statusFarben`) — ein neuer
       * ETB-Typ taucht damit von selbst im Trichter auf. Dass der Drahtwert (`lage`) hier
       * zufällig fast wie sein Label („Lage") aussieht, ändert nichts: der Typ gehört in den
       * Filter, nicht in den Suchplatzhalter, sonst hinge das Versprechen an einem Zufall.
       */
      filters: (Object.keys(etbTyp) as EtbBaustein['typ'][]).map((t) => ({
        text: etbTyp[t].label,
        value: t,
      })),
      onFilter: (wert, b) => b.typ === wert,
      render: (t: EtbBaustein['typ']) => <Tag>{etbTyp[t].label}</Tag>,
    },
    { title: 'Sortierung', dataIndex: 'sortier', key: 'sortier' },
    ...(istAdmin
      ? ([
          {
            title: 'Aktionen',
            key: 'aktionen',
            render: (_, b: EtbBaustein) => (
              <Space size="middle">
                <Button onClick={() => { setBearbeite(b); setModalOffen(true); }}>
                  Bearbeiten
                </Button>
                <Popconfirm
                  title="Baustein deaktivieren?"
                  okButtonProps={{ danger: true }}
                  onConfirm={() => deaktivieren.mutate(b.id)}
                >
                  <Button danger>Deaktivieren</Button>
                </Popconfirm>
              </Space>
            ),
          },
        ] as TableColumnsType<EtbBaustein>)
      : []),
  ];

  return (
    <AdminPage
      titel="ETB-Schnellbausteine"
      aktionen={
        /* Der Knopf VERSCHWINDET nicht mehr, wenn das Recht fehlt (M16, LFH-345 · C10) —
           er steht gesperrt, den Grund nennt der Hinweis darunter. Ein fehlender Knopf ist
           von „diese Seite kann das gar nicht" nicht zu unterscheiden; „ausgegraut" allein
           wäre eine Ein-Kanal-Aussage (Grau ist eine Farbe, WCAG 1.4.1).
           Der Slot liegt AUSSERHALB jedes `<form>` (Dateikopf `AdminPage`) — hier steht
           deshalb nie ein `htmlType="submit"`, sondern immer ein Modal-Öffner. */
        <Button type="primary" disabled={!istAdmin} onClick={() => { setBearbeite(null); setModalOffen(true); }}>
          Baustein anlegen
        </Button>
      }
      hinweis={<SeitenHinweise rechteFehlt={!istAdmin} rechteText={STAMMDATEN_RECHTE_TEXT} />}
    >
      {/* Der Fehler tauscht die Tabelle aus, statt durch sie hindurchgereicht zu werden
          (LFH-331 · B3): `Datensicht` führt den Kartenzweig an `Liste`, und `ListeProps`
          kennt keinen Fehlerbegriff — ein Prop am Tabellen-Primitiv wirkte nur in einer
          der beiden Formen. Ohne diese Weiche behauptet „Keine Bausteine" auch dann
          einen leeren Katalog, wenn bloß die Verbindung abgerissen ist. */}
      {query.isError ? (
        <SeitenFehler
          text="ETB-Bausteine konnten nicht geladen werden"
          ursache={query.error}
          onWiederholen={() => void query.refetch()}
        />
      ) : (
        <KatalogTabelle
          rowKey="id"
          loading={query.isLoading}
          dataSource={query.data ?? []}
          columns={spalten}
          /**
           * NUR „Label" — seit der Zwei-Zeilen-Zelle (LFH-346 · A4) entsteht der Inhalt erst
           * beim Rendern und liegt damit außerhalb des Suchkorpus des Primitivs, das die
           * Rohwerte der Spalten mit Datenbezug liest. Der frühere Wortlaut „Label oder
           * Inhalt" wäre jetzt ein Versprechen, das die Suche nicht hält.
           */
          suche={{ platzhalter: 'Label' }}
          locale={{ emptyText: 'Keine Bausteine' }}
        />
      )}
      <EtbBausteinFormModal offen={modalOffen} baustein={bearbeite} onClose={() => setModalOffen(false)} />
    </AdminPage>
  );
}
