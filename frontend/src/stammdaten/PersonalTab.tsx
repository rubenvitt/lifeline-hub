import { App, Button, Popconfirm, Space, Table, Tag, type TableColumnsType } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';
import { ladePersonalVorschlaege, listePersonal, POSITION_LABELS, setzeDienststatus } from '../api/personal';
import type { Personal, StaerkePosition } from '../api/types';
import PersonalFormModal from './PersonalFormModal';

export default function PersonalTab() {
  const { benutzer } = useAuth();
  const istAdmin = benutzer?.system_rolle === 'admin';
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [modalOffen, setModalOffen] = useState(false);
  const [bearbeite, setBearbeite] = useState<Personal | null>(null);

  const personalQuery = useQuery({ queryKey: ['personal', 'alle'], queryFn: () => listePersonal(false) });
  const vorschlaegeQuery = useQuery({ queryKey: ['personal-vorschlaege'], queryFn: ladePersonalVorschlaege });

  const dienststatusMutation = useMutation({
    mutationFn: (v: { id: number; inDienst: boolean }) => setzeDienststatus(v.id, v.inDienst),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['personal'] }),
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen'),
  });

  const spalten: TableColumnsType<Personal> = [
    { title: 'Name', dataIndex: 'name', key: 'name' },
    { title: 'Personalnr.', dataIndex: 'personalnummer', key: 'personalnummer', render: (t) => t ?? '—' },
    {
      title: 'Qualifikationen',
      key: 'qualifikationen',
      render: (_, p) =>
        p.qualifikationen.length ? (
          <Space size={[0, 4]} wrap>
            {p.qualifikationen.map((q) => <Tag key={q.id}>{q.label}</Tag>)}
          </Space>
        ) : '—',
    },
    {
      title: 'Stärke-Position',
      dataIndex: 'staerke_position',
      key: 'staerke_position',
      render: (p: StaerkePosition | null) => (p ? POSITION_LABELS[p] : '—'),
    },
    { title: 'Träger', dataIndex: 'traegerorganisation', key: 'traeger', render: (t) => t ?? '—' },
    {
      title: 'Status',
      key: 'dienststatus',
      render: (_, p) =>
        p.dienststatus === 'in_dienst' ? <Tag color="green">in Dienst</Tag> : <Tag>außer Dienst</Tag>,
    },
    ...(istAdmin
      ? ([
          {
            title: 'Aktionen',
            key: 'aktionen',
            render: (_, p: Personal) => (
              <Space>
                <Button size="small" onClick={() => { setBearbeite(p); setModalOffen(true); }}>Bearbeiten</Button>
                {p.dienststatus === 'in_dienst' ? (
                  <Popconfirm title="Außer Dienst stellen?" onConfirm={() => dienststatusMutation.mutate({ id: p.id, inDienst: false })}>
                    <Button size="small" danger>Außer Dienst</Button>
                  </Popconfirm>
                ) : (
                  <Button size="small" onClick={() => dienststatusMutation.mutate({ id: p.id, inDienst: true })}>
                    Wieder in Dienst
                  </Button>
                )}
              </Space>
            ),
          },
        ] as TableColumnsType<Personal>)
      : []),
  ];

  return (
    <>
      {istAdmin && (
        <Button type="primary" style={{ marginBottom: 12 }} onClick={() => { setBearbeite(null); setModalOffen(true); }}>
          Person anlegen
        </Button>
      )}
      <Table
        rowKey="id"
        loading={personalQuery.isLoading}
        dataSource={personalQuery.data ?? []}
        columns={spalten}
        locale={{ emptyText: 'Noch kein Personal' }}
        pagination={false}
      />
      <PersonalFormModal
        offen={modalOffen}
        person={bearbeite}
        vorschlaege={vorschlaegeQuery.data ?? { traegerorganisation: [] }}
        onClose={() => setModalOffen(false)}
      />
    </>
  );
}
