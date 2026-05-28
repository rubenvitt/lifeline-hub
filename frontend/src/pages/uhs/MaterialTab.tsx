import { useState } from 'react';
import { Button, Popconfirm, Select, Space, Table, Modal, App } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { listeEinsatzMaterial, aktualisiereDisposition } from '../../api/einsatzMaterial';
import type { EinsatzMaterial, UhsDetail } from '../../api/types';
import { ApiError } from '../../api/client';

interface Props {
  einsatzId: number;
  uhs: UhsDetail;
  schreibgeschuetzt: boolean;
}

export default function MaterialTab({ einsatzId, uhs, schreibgeschuetzt }: Props) {
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [zuordnenOffen, setZuordnenOffen] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const materialQuery = useQuery({
    queryKey: ['einsatz-material', einsatzId],
    queryFn: () => listeEinsatzMaterial(einsatzId),
  });

  const material = materialQuery.data ?? [];
  const verortet = material.filter((em) => em.uhs_id === uhs.id);
  const freiVerortbar = material.filter((em) => em.uhs_id == null);

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['einsatz-material', einsatzId] });
    qc.invalidateQueries({ queryKey: ['einsatz-uhs-detail', einsatzId, uhs.id] });
  }

  const fehler = (e: unknown) =>
    message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen');

  const loesenMut = useMutation({
    mutationFn: (emId: number) =>
      aktualisiereDisposition(einsatzId, emId, { uhs_id: null }),
    onSuccess: () => { message.success('Material gelöst'); invalidate(); },
    onError: fehler,
  });

  const zuordnenMut = useMutation({
    mutationFn: (emId: number) =>
      aktualisiereDisposition(einsatzId, emId, { uhs_id: uhs.id }),
    onSuccess: () => {
      message.success('Material zugeordnet');
      setZuordnenOffen(false);
      setSelectedId(null);
      invalidate();
    },
    onError: fehler,
  });

  const columns = [
    { title: 'Bezeichnung', dataIndex: 'bezeichnung', key: 'bezeichnung' },
    { title: 'Kategorie', dataIndex: 'kategorie', key: 'kategorie',
      render: (v: string | null) => v ?? '—' },
    { title: 'Menge', dataIndex: 'menge', key: 'menge' },
    { title: 'Status', dataIndex: 'status', key: 'status' },
    {
      title: 'Aktion', key: 'aktion',
      render: (_: unknown, em: EinsatzMaterial) =>
        !schreibgeschuetzt ? (
          <Popconfirm
            title="Material lösen?"
            description="Das Material wird nicht mehr dieser UHS zugeordnet."
            onConfirm={() => loesenMut.mutate(em.id)}
            okText="Lösen"
          >
            <Button size="small" danger>Lösen</Button>
          </Popconfirm>
        ) : null,
    },
  ];

  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      {!schreibgeschuetzt && (
        <Button
          onClick={() => setZuordnenOffen(true)}
          disabled={freiVerortbar.length === 0}
        >
          Material zuordnen
        </Button>
      )}
      <Table<EinsatzMaterial>
        rowKey="id"
        dataSource={verortet}
        columns={columns}
        size="small"
        pagination={false}
        locale={{ emptyText: 'Kein Material dieser UHS zugeordnet' }}
        loading={materialQuery.isLoading}
      />
      <Modal
        title="Material zuordnen"
        open={zuordnenOffen}
        onCancel={() => { setZuordnenOffen(false); setSelectedId(null); }}
        onOk={() => { if (selectedId != null) zuordnenMut.mutate(selectedId); }}
        okButtonProps={{ disabled: selectedId == null, loading: zuordnenMut.isPending }}
        okText="Zuordnen"
      >
        <Select
          style={{ width: '100%' }}
          placeholder="Material auswählen…"
          value={selectedId}
          onChange={(v) => setSelectedId(v)}
          options={freiVerortbar.map((em) => ({
            value: em.id,
            label: `${em.bezeichnung}${em.kategorie ? ` (${em.kategorie})` : ''} — ${em.menge}×`,
          }))}
        />
      </Modal>
    </Space>
  );
}
