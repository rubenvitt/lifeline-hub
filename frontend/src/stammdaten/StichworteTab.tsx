import { App, Button, Input, Space, Table, Typography, type TableColumnsType } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';
import {
  legeStichwortVorschlagAn,
  listeStichwortVorschlaege,
  loescheStichwortVorschlag,
} from '../api/stichwortVorschlaege';
import type { StichwortVorschlag } from '../api/types';

export default function StichworteTab() {
  const { benutzer } = useAuth();
  const istAdmin = benutzer?.system_rolle === 'admin';
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [neuerText, setNeuerText] = useState('');

  const vorschlaegeQuery = useQuery({
    queryKey: ['stichwort-vorschlaege'],
    queryFn: listeStichwortVorschlaege,
  });

  const anlegenMutation = useMutation({
    mutationFn: (text: string) => legeStichwortVorschlagAn(text),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stichwort-vorschlaege'] });
      setNeuerText('');
    },
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Hinzufügen fehlgeschlagen'),
  });

  const loeschenMutation = useMutation({
    mutationFn: (id: number) => loescheStichwortVorschlag(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['stichwort-vorschlaege'] }),
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Löschen fehlgeschlagen'),
  });

  function hinzufuegen() {
    const text = neuerText.trim();
    if (text) anlegenMutation.mutate(text);
  }

  const vorschlaege = vorschlaegeQuery.data ?? [];

  const spalten: TableColumnsType<StichwortVorschlag> = [
    { title: 'Stichwort', dataIndex: 'text', key: 'text' },
    ...(istAdmin
      ? ([
          {
            title: 'Aktionen',
            key: 'aktionen',
            width: 120,
            render: (_, v: StichwortVorschlag) => (
              <Button
                danger
                size="small"
                loading={loeschenMutation.isPending}
                onClick={() => loeschenMutation.mutate(v.id)}
              >
                Löschen
              </Button>
            ),
          },
        ] as TableColumnsType<StichwortVorschlag>)
      : []),
  ];

  return (
    <>
      <Typography.Paragraph type="secondary">
        Vorschläge für die Stichwort-Combobox im Einsatzdaten-Modul. Freie Eingabe bleibt im
        Einsatz unabhängig davon möglich.
      </Typography.Paragraph>

      <Table
        rowKey="id"
        loading={vorschlaegeQuery.isLoading}
        dataSource={vorschlaege}
        columns={spalten}
        locale={{ emptyText: 'Noch keine Stichworte' }}
        pagination={false}
      />

      {istAdmin && (
        <Space.Compact style={{ marginTop: 12, width: '100%' }}>
          <Input
            value={neuerText}
            onChange={(e) => setNeuerText(e.target.value)}
            onPressEnter={hinzufuegen}
            placeholder="Neues Stichwort, z. B. H1Y"
          />
          <Button type="primary" loading={anlegenMutation.isPending} onClick={hinzufuegen}>
            Hinzufügen
          </Button>
        </Space.Compact>
      )}
    </>
  );
}
