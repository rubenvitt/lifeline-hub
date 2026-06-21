import { App, Button, Popconfirm, Space, Table, Tag, type TableColumnsType } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';
import { ladeFahrzeugVorschlaege, listeFahrzeuge, setzeDienststatus } from '../api/fahrzeuge';
import type { Fahrzeug } from '../api/types';
import FahrzeugFormModal from './FahrzeugFormModal';

function staerkeText(f: Fahrzeug): string {
  if (!f.staerke) return '—';
  const { fuehrer, unterfuehrer, mannschaft } = f.staerke;
  return `${fuehrer}/${unterfuehrer}/${mannschaft}//${fuehrer + unterfuehrer + mannschaft}`;
}

export default function FahrzeugeTab() {
  const { benutzer } = useAuth();
  const istAdmin = benutzer?.system_rolle === 'admin';
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [modalOffen, setModalOffen] = useState(false);
  const [bearbeite, setBearbeite] = useState<Fahrzeug | null>(null);

  const fahrzeugeQuery = useQuery({ queryKey: ['fahrzeuge', 'alle'], queryFn: () => listeFahrzeuge(false) });
  const vorschlaegeQuery = useQuery({ queryKey: ['fahrzeug-vorschlaege'], queryFn: ladeFahrzeugVorschlaege });

  const dienststatusMutation = useMutation({
    mutationFn: (v: { id: number; inDienst: boolean }) => setzeDienststatus(v.id, v.inDienst),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['fahrzeuge'] }),
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen'),
  });

  const spalten: TableColumnsType<Fahrzeug> = [
    { title: 'Funkrufname', dataIndex: 'funkrufname', key: 'funkrufname' },
    { title: 'Typ', dataIndex: 'fahrzeugtyp', key: 'fahrzeugtyp', render: (t) => t ?? '—' },
    { title: 'Träger', dataIndex: 'traegerorganisation', key: 'traeger', render: (t) => t ?? '—' },
    { title: 'Kennzeichen', dataIndex: 'kennzeichen', key: 'kennzeichen', render: (t) => t ?? '—' },
    { title: 'Stärke', key: 'staerke', render: (_, f) => staerkeText(f) },
    {
      title: 'Status',
      key: 'dienststatus',
      render: (_, f) =>
        f.dienststatus === 'in_dienst' ? <Tag color="green">in Dienst</Tag> : <Tag>außer Dienst</Tag>,
    },
    ...(istAdmin
      ? ([
          {
            title: 'Aktionen',
            key: 'aktionen',
            render: (_, f: Fahrzeug) => (
              <Space>
                <Button size="small" onClick={() => { setBearbeite(f); setModalOffen(true); }}>
                  Bearbeiten
                </Button>
                {f.dienststatus === 'in_dienst' ? (
                  <Popconfirm
                    title="Außer Dienst stellen?"
                    onConfirm={() => dienststatusMutation.mutate({ id: f.id, inDienst: false })}
                  >
                    <Button size="small" danger>Außer Dienst</Button>
                  </Popconfirm>
                ) : (
                  <Button size="small" onClick={() => dienststatusMutation.mutate({ id: f.id, inDienst: true })}>
                    Wieder in Dienst
                  </Button>
                )}
              </Space>
            ),
          },
        ] as TableColumnsType<Fahrzeug>)
      : []),
  ];

  return (
    <>
      {istAdmin && (
        <Button type="primary" style={{ marginBottom: 12 }} onClick={() => { setBearbeite(null); setModalOffen(true); }}>
          Fahrzeug anlegen
        </Button>
      )}
      <Table
        rowKey="id"
        loading={fahrzeugeQuery.isLoading}
        dataSource={fahrzeugeQuery.data ?? []}
        columns={spalten}
        locale={{ emptyText: 'Noch keine Fahrzeuge' }}
        pagination={false}
      />
      <FahrzeugFormModal
        offen={modalOffen}
        fahrzeug={bearbeite}
        vorschlaege={vorschlaegeQuery.data ?? { fahrzeugtyp: [], traegerorganisation: [], standort: [] }}
        onClose={() => setModalOffen(false)}
      />
    </>
  );
}
