import { App, Button, Popconfirm, Space, Tag, type TableColumnsType } from 'antd';
import KatalogTabelle from '../components/KatalogTabelle';
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
    { title: 'Label', dataIndex: 'label', key: 'label' },
    { title: 'Typ', dataIndex: 'typ', key: 'typ', render: (t: EtbBaustein['typ']) => <Tag>{etbTyp[t].label}</Tag> },
    { title: 'Inhalt', dataIndex: 'inhalt', key: 'inhalt' },
    { title: 'Sortierung', dataIndex: 'sortier', key: 'sortier' },
    ...(istAdmin
      ? ([
          {
            title: 'Aktionen',
            key: 'aktionen',
            render: (_, b: EtbBaustein) => (
              <Space>
                <Button onClick={() => { setBearbeite(b); setModalOffen(true); }}>
                  Bearbeiten
                </Button>
                <Popconfirm title="Baustein deaktivieren?" onConfirm={() => deaktivieren.mutate(b.id)}>
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
      <KatalogTabelle
        rowKey="id"
        loading={query.isLoading}
        dataSource={query.data ?? []}
        columns={spalten}
        locale={{ emptyText: 'Keine Bausteine' }}
      />
      <EtbBausteinFormModal offen={modalOffen} baustein={bearbeite} onClose={() => setModalOffen(false)} />
    </>
  );
}
