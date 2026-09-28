import { App, Button, Popconfirm, Space, Typography, theme } from 'antd';
import AdminPage from '../components/AdminPage';
import { SeitenHinweise } from '../components/SpeicherHinweis';
import KatalogTabelle, { type KatalogSpalte } from '../components/KatalogTabelle';
import { SeitenFehler } from '../components/SeitenZustand';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';
import { deaktiviereBaustein, listeBausteine } from '../api/etbBaustein';
import type { EtbBaustein } from '../api/types';
import { monoStil } from '../components/instrument';
import { etbTyp, etbTypFarbe } from '../theme/statusFarben';
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
    onError: (e) =>
      message.error(e instanceof ApiError ? e.message : 'Deaktivieren fehlgeschlagen'),
  });

  const spalten: KatalogSpalte<EtbBaustein>[] = [
    {
      title: 'Baustein',
      dataIndex: 'label',
      key: 'baustein',
      /**
       * Leitspalte: an ihr sucht ein Mensch den Baustein. Kein `defaultSortOrder` — die fachliche
       * Reihenfolge ist `sortier` (`ORDER BY sortier, id`); sie bestimmt, in welcher Folge die
       * Bausteine im ETB angeboten werden, und bleibt der Einstieg.
       *
       * ZWEI ZEILEN, EINE ZELLE (LFH-346): Label und Inhalt werden zusammen gelesen („was fügt
       * dieser Baustein ein?"), nicht verglichen.
       *
       * `dataIndex: 'label'` trägt Sortierung und angezeigten Wert, aber nicht den Suchkorpus: der
       * Inhalt steht im `render`, und das liest die Suche nicht. Der `suchText`-Haken unten gewinnt
       * über den `dataIndex` und nimmt deshalb BEIDE Werte auf; ein Haken nur mit dem Inhalt
       * verlöre das Label.
       *
       * Gekappt wird an der ZELLE, nicht über eine Spaltenbreite: unter `table-layout: auto`, das
       * `KatalogTabelle` mit `scroll={{ x: 'max-content' }}` erzwingt, ist eine Spaltenbreite
       * wirkungslos (Herleitung in `karten/OnlineQuellenVerwaltung.tsx`). Einzeilig über
       * `Typography.Text` — mehrzeilig kürzt antd 6 nur über `Paragraph`.
       */
      sorter: (a, b) => a.label.localeCompare(b.label, 'de'),
      // Beide Werte, durch Leerzeichen getrennt: ein Begriff, der über die Grenze hinweg
      // ginge („unverändertLage"), wäre kein Wort, das jemand sucht.
      suchText: (b: EtbBaustein) => `${b.label} ${b.inhalt}`,
      onCell: () => ({ style: { maxWidth: 320 } }),
      render: (label: string, b: EtbBaustein) => (
        <>
          {/* Die Marke trägt die Testabfrage: der `textContent` der Zelle enthält Label UND Inhalt. */}
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
       * Werte aus derselben Quelle wie die Anzeige (`theme/statusFarben`) — ein neuer ETB-Typ
       * taucht von selbst im Trichter auf. Der Typ gehört in den Filter, nicht in den
       * Suchplatzhalter: dass der Drahtwert (`lage`) fast wie sein Label aussieht, ist Zufall.
       */
      filters: (Object.keys(etbTyp) as EtbBaustein['typ'][]).map((t) => ({
        text: etbTyp[t].label,
        value: t,
      })),
      onFilter: (wert, b) => b.typ === wert,
      // Typ als KANTE + TYPWORT wie auf der ETB-Zeitachse, nicht als Etikett: derselbe Typ sieht im
      // Katalog aus wie im Tagebuch, das er befüllt.
      render: (t: EtbBaustein['typ']) => {
        const farbe = etbTypFarbe(t, token);
        return (
          <span
            data-typ={t}
            style={{
              ...monoStil(11, 500),
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: farbe.wort,
              borderInlineStart: `2px solid ${farbe.kante}`,
              paddingInlineStart: token.paddingXS,
            }}
          >
            {etbTyp[t].label}
          </span>
        );
      },
    },
    {
      title: 'Sortierung',
      dataIndex: 'sortier',
      key: 'sortier',
      // Zahlen in Mono — die Spalte wird zeilenweise verglichen.
      render: (n: number) => <span style={monoStil(12)}>{n}</span>,
    },
    ...(istAdmin
      ? ([
          {
            title: 'Aktionen',
            key: 'aktionen',
            render: (_, b: EtbBaustein) => (
              <Space size="middle">
                <Button
                  onClick={() => {
                    setBearbeite(b);
                    setModalOffen(true);
                  }}
                >
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
        ] as KatalogSpalte<EtbBaustein>[])
      : []),
  ];

  return (
    <AdminPage
      titel="ETB-Schnellbausteine"
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
          Baustein anlegen
        </Button>
      }
      hinweis={<SeitenHinweise rechteFehlt={!istAdmin} rechteText={STAMMDATEN_RECHTE_TEXT} />}
    >
      {/* Der Fehler tauscht die Tabelle aus (LFH-331): `Datensicht` führt den Kartenzweig an
         `Liste`, und `ListeProps` kennt keinen Fehlerbegriff. Ohne diese Weiche behauptete „Keine
         Bausteine" einen leeren Katalog, wenn bloß die Verbindung abgerissen ist. */}
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
           * Beides: der `suchText`-Haken der Leitspalte hält den Inhalt im Korpus. Der Platzhalter ist
           * an den Haken gebunden — wer ihn entfernt, nimmt hier „oder Inhalt" mit heraus.
           */
          suche={{ platzhalter: 'Label oder Inhalt' }}
          locale={{ emptyText: 'Keine Bausteine' }}
        />
      )}
      <EtbBausteinFormModal
        offen={modalOffen}
        baustein={bearbeite}
        onClose={() => setModalOffen(false)}
      />
    </AdminPage>
  );
}
