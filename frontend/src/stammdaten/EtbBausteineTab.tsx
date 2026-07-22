import { App, Button, Popconfirm, Space, Table, Tag, type TableColumnsType } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';
import { deaktiviereBaustein, listeBausteine } from '../api/etbBaustein';
import type { EtbBaustein } from '../api/types';
import { TYP_LABEL } from '../etb/typFarben';
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
    { title: 'Typ', dataIndex: 'typ', key: 'typ', render: (t: EtbBaustein['typ']) => <Tag>{TYP_LABEL[t]}</Tag> },
    { title: 'Inhalt', dataIndex: 'inhalt', key: 'inhalt' },
    { title: 'Sortierung', dataIndex: 'sortier', key: 'sortier' },
    ...(istAdmin
      ? ([
          {
            title: 'Aktionen',
            key: 'aktionen',
            render: (_, b: EtbBaustein) => (
              <Space>
                <Button size="small" onClick={() => { setBearbeite(b); setModalOffen(true); }}>
                  Bearbeiten
                </Button>
                <Popconfirm title="Baustein deaktivieren?" onConfirm={() => deaktivieren.mutate(b.id)}>
                  <Button size="small" danger>Deaktivieren</Button>
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
        <Button type="primary" style={{ marginBottom: 12 }} onClick={() => { setBearbeite(null); setModalOffen(true); }}>
          Baustein anlegen
        </Button>
      )}
      <Table
        rowKey="id"
        loading={query.isLoading}
        dataSource={query.data ?? []}
        columns={spalten}
        pagination={false}
        locale={{ emptyText: 'Keine Bausteine' }}
      />
      <EtbBausteinFormModal offen={modalOffen} baustein={bearbeite} onClose={() => setModalOffen(false)} />
    </>
  );
}
