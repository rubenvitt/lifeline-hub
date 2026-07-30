import { App, Button, Popconfirm, Space, Tag, type TableColumnsType } from 'antd';
import KatalogTabelle from '../components/KatalogTabelle';
import { SeitenFehler } from '../components/SeitenZustand';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';
import { deaktiviereBaustein, listeBausteine } from '../api/etbBaustein';
import type { EtbBaustein } from '../api/types';
import { etbTyp } from '../theme/statusFarben';
import { abstand } from '../theme/tokens';
import EtbBausteinFormModal from './EtbBausteinFormModal';
import { globalKeys } from '../api/queryKeys';

export default function EtbBausteineTab() {
  const { benutzer } = useAuth();
  const istAdmin = benutzer?.system_rolle === 'admin';
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [modalOffen, setModalOffen] = useState(false);
  const [bearbeite, setBearbeite] = useState<EtbBaustein | null>(null);

  const query = useQuery({ queryKey: globalKeys.etbBausteine(), queryFn: listeBausteine });

  const deaktivieren = useMutation({
    mutationFn: (id: number) => deaktiviereBaustein(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: globalKeys.etbBausteine() }),
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Deaktivieren fehlgeschlagen'),
  });

  const spalten: TableColumnsType<EtbBaustein> = [
    {
      title: 'Label',
      dataIndex: 'label',
      key: 'label',
      /**
       * Leitspalte: an ihr sucht ein Mensch den Baustein. Kein `defaultSortOrder` — die
       * fachliche Reihenfolge ist `sortier` und kommt vom Server
       * (`src/etb_baustein/repo.rs:47` — `ORDER BY sortier, id`); sie bestimmt, in welcher
       * Folge die Bausteine im ETB angeboten werden, und bleibt deshalb der Einstieg.
       */
      sorter: (a, b) => a.label.localeCompare(b.label, 'de'),
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
    { title: 'Inhalt', dataIndex: 'inhalt', key: 'inhalt' },
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
    <>
      {istAdmin && (
        <Button type="primary" style={{ marginBottom: abstand.md }} onClick={() => { setBearbeite(null); setModalOffen(true); }}>
          Baustein anlegen
        </Button>
      )}
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
           * Label UND Inhalt sind genannt, weil beide echten Fließtext tragen und die Suche des
           * Primitivs die Rohwerte aller Spalten mit Datenbezug liest — den Baustein sucht man
           * mal am Namen, mal an einer Wendung aus dem Text.
           */
          suche={{ platzhalter: 'Label oder Inhalt' }}
          locale={{ emptyText: 'Keine Bausteine' }}
        />
      )}
      <EtbBausteinFormModal offen={modalOffen} baustein={bearbeite} onClose={() => setModalOffen(false)} />
    </>
  );
}
