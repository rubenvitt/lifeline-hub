import { App, Button, Form, Input, InputNumber, Modal, Popconfirm, Space, type TableColumnsType } from 'antd';
import KatalogTabelle from '../components/KatalogTabelle';
import { Select } from '../components/Select';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';
import {
  aktualisiereStatus, deaktiviereStatus, legeStatusAn, listeFahrzeugStatus, type StatusEingabe,
} from '../api/fahrzeugStatus';
import type { FahrzeugStatus, StatusKategorie } from '../api/types';
import { globalKeys } from '../api/queryKeys';
import { leerZuNull } from '../api/patchTriState';
import StatusTag from '../components/StatusTag';
import { statusKategorie } from '../theme/statusFarben';


interface FormWerte {
  label: string;
  kategorie: StatusKategorie;
  farbe?: string;
  fms_anker?: number;
  sortier: number;
}

export default function StatusKatalogTab() {
  const { benutzer } = useAuth();
  const istAdmin = benutzer?.system_rolle === 'admin';
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [form] = Form.useForm<FormWerte>();
  const [modalOffen, setModalOffen] = useState(false);
  const [bearbeite, setBearbeite] = useState<FahrzeugStatus | null>(null);

  const statusQuery = useQuery({ queryKey: globalKeys.fahrzeugStatus(), queryFn: listeFahrzeugStatus });

  const speichern = useMutation({
    mutationFn: (werte: FormWerte) => {
      const daten: StatusEingabe = {
        label: werte.label.trim(),
        kategorie: werte.kategorie,
        farbe: leerZuNull(werte.farbe),
        fms_anker: werte.fms_anker ?? null,
        sortier: werte.sortier ?? 0,
      };
      return bearbeite ? aktualisiereStatus(bearbeite.id, daten) : legeStatusAn(daten);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: globalKeys.fahrzeugStatus() });
      setModalOffen(false);
    },
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Speichern fehlgeschlagen'),
  });

  const deaktivieren = useMutation({
    mutationFn: (id: number) => deaktiviereStatus(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: globalKeys.fahrzeugStatus() }),
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Deaktivieren fehlgeschlagen'),
  });

  useEffect(() => {
    if (!modalOffen) return;
    if (bearbeite) {
      form.setFieldsValue({
        label: bearbeite.label,
        kategorie: bearbeite.kategorie,
        farbe: bearbeite.farbe ?? undefined,
        fms_anker: bearbeite.fms_anker ?? undefined,
        sortier: bearbeite.sortier,
      });
    } else {
      form.resetFields();
      form.setFieldsValue({ kategorie: 'gebunden', sortier: 0 });
    }
  }, [modalOffen, bearbeite, form]);

  const spalten: TableColumnsType<FahrzeugStatus> = [
    { title: 'Label', dataIndex: 'label', key: 'label' },
    {
      title: 'Kategorie',
      dataIndex: 'kategorie',
      key: 'kategorie',
      render: (k: StatusKategorie) => <StatusTag darstellung={statusKategorie[k]} />,
    },
    { title: 'Farbe', dataIndex: 'farbe', key: 'farbe', render: (f) => f ?? '—' },
    { title: 'FMS-Anker', dataIndex: 'fms_anker', key: 'fms_anker', render: (f) => f ?? '—' },
    { title: 'Sortierung', dataIndex: 'sortier', key: 'sortier' },
    ...(istAdmin
      ? ([
          {
            title: 'Aktionen',
            key: 'aktionen',
            render: (_, s: FahrzeugStatus) => (
              <Space>
                <Button onClick={() => { setBearbeite(s); setModalOffen(true); }}>
                  Bearbeiten
                </Button>
                <Popconfirm title="Status deaktivieren?" onConfirm={() => deaktivieren.mutate(s.id)}>
                  <Button danger>Deaktivieren</Button>
                </Popconfirm>
              </Space>
            ),
          },
        ] as TableColumnsType<FahrzeugStatus>)
      : []),
  ];

  return (
    <>
      {istAdmin && (
        <Button type="primary" style={{ marginBottom: 12 }} onClick={() => { setBearbeite(null); setModalOffen(true); }}>
          Status anlegen
        </Button>
      )}
      <KatalogTabelle
        rowKey="id"
        loading={statusQuery.isLoading}
        dataSource={statusQuery.data ?? []}
        columns={spalten}
        locale={{ emptyText: 'Kein Status' }}
      />
      <Modal
        open={modalOffen}
        title={bearbeite ? 'Status bearbeiten' : 'Status anlegen'}
        okText="Speichern"
        confirmLoading={speichern.isPending}
        onOk={() => form.submit()}
        onCancel={() => setModalOffen(false)}
        destroyOnHidden
      >
        <Form<FormWerte> form={form} layout="vertical" onFinish={(w) => speichern.mutate(w)}>
          <Form.Item label="Label" name="label" rules={[{ required: true, whitespace: true }]}>
            <Input />
          </Form.Item>
          <Form.Item label="Kategorie" name="kategorie" rules={[{ required: true }]}>
            <Select
              options={(Object.keys(statusKategorie) as StatusKategorie[]).map((k) => ({
                value: k,
                label: statusKategorie[k].label,
              }))}
            />
          </Form.Item>
          <Form.Item label="Farbe (Hex, optional)" name="farbe">
            <Input placeholder="#22aa55" />
          </Form.Item>
          <Form.Item label="FMS-Anker (0–9, optional)" name="fms_anker">
            <InputNumber min={0} max={9} style={{ width: '100%', maxWidth: 120 }} />
          </Form.Item>
          <Form.Item label="Sortierung" name="sortier">
            <InputNumber min={0} style={{ width: '100%', maxWidth: 120 }} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
