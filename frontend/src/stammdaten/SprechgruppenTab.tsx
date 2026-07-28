import { App, Button, Popconfirm, Space, Tag, type TableColumnsType } from 'antd';
import KatalogTabelle from '../components/KatalogTabelle';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';
import { deaktiviereSprechgruppe, listeSprechgruppen } from '../api/sprechgruppen';
import type { Sprechgruppe } from '../api/types';
import SprechgruppeFormModal from './SprechgruppeFormModal';
import { globalKeys } from '../api/queryKeys';

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
    { title: 'Bezeichnung', dataIndex: 'bezeichnung', key: 'bezeichnung' },
    {
      title: 'Betriebsart',
      dataIndex: 'betriebsart',
      key: 'betriebsart',
      render: (ba: string) => <Tag color={ba === 'TMO' ? 'blue' : 'orange'}>{ba}</Tag>,
    },
    {
      title: 'Hinweis',
      dataIndex: 'hinweis',
      key: 'hinweis',
      render: (h: string | null) => h ?? '—',
    },
    {
      title: 'Aktiv',
      dataIndex: 'aktiv',
      key: 'aktiv',
      render: (aktiv: boolean) =>
        aktiv ? <Tag color="green">Aktiv</Tag> : <Tag>Inaktiv</Tag>,
    },
    ...(istAdmin
      ? ([
          {
            title: 'Aktionen',
            key: 'aktionen',
            render: (_, sg: Sprechgruppe) => (
              <Space>
                <Button
                  size="small"
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
                    onConfirm={() => deaktivierenMutation.mutate(sg.id)}
                  >
                    <Button size="small" danger>
                      Deaktivieren
                    </Button>
                  </Popconfirm>
                )}
              </Space>
            ),
          },
        ] as TableColumnsType<Sprechgruppe>)
      : []),
  ];

  return (
    <>
      {istAdmin && (
        <Button
          type="primary"
          style={{ marginBottom: 12 }}
          onClick={() => {
            setBearbeite(null);
            setModalOffen(true);
          }}
        >
          Sprechgruppe anlegen
        </Button>
      )}
      <KatalogTabelle
        rowKey="id"
        loading={sprechgruppenQuery.isLoading}
        dataSource={sprechgruppenQuery.data ?? []}
        columns={spalten}
        locale={{ emptyText: 'Noch keine Sprechgruppen' }}
      />
      <SprechgruppeFormModal
        offen={modalOffen}
        sprechgruppe={bearbeite}
        onClose={() => setModalOffen(false)}
      />
    </>
  );
}
