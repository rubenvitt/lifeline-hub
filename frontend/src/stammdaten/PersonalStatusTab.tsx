import { App, Button, Form, Input, InputNumber, Modal, Popconfirm, Space, Table, Tag, type TableColumnsType } from 'antd';
import { Select } from '../components/Select';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';
import {
  aktualisiereStatus, deaktiviereStatus, legeStatusAn, listePersonalStatus, type StatusEingabe,
} from '../api/personalStatus';
import type { PersonalStatus, StatusKategorie } from '../api/types';
import { globalKeys } from '../api/queryKeys';

const KATEGORIE_LABELS: Record<StatusKategorie, string> = {
  verfuegbar: 'verfügbar',
  gebunden: 'gebunden',
  nicht_verfuegbar: 'nicht verfügbar',
};
const KATEGORIE_FARBEN: Record<StatusKategorie, string> = {
  verfuegbar: 'green',
  gebunden: 'orange',
  nicht_verfuegbar: 'red',
};

interface FormWerte {
  label: string;
  kategorie: StatusKategorie;
  farbe?: string;
  sortier: number;
}

export default function PersonalStatusTab() {
  const { benutzer } = useAuth();
  const istAdmin = benutzer?.system_rolle === 'admin';
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [form] = Form.useForm<FormWerte>();
  const [modalOffen, setModalOffen] = useState(false);
  const [bearbeite, setBearbeite] = useState<PersonalStatus | null>(null);

  const statusQuery = useQuery({ queryKey: globalKeys.personalStatus(), queryFn: listePersonalStatus });

  const speichern = useMutation({
    mutationFn: (werte: FormWerte) => {
      const daten: StatusEingabe = {
        label: werte.label.trim(),
        kategorie: werte.kategorie,
        farbe: werte.farbe?.trim() || null,
        sortier: werte.sortier ?? 0,
      };
      return bearbeite ? aktualisiereStatus(bearbeite.id, daten) : legeStatusAn(daten);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: globalKeys.personalStatus() }); setModalOffen(false); },
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Speichern fehlgeschlagen'),
  });

  const deaktivieren = useMutation({
    mutationFn: (id: number) => deaktiviereStatus(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: globalKeys.personalStatus() }),
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Deaktivieren fehlgeschlagen'),
  });

  useEffect(() => {
    if (!modalOffen) return;
    if (bearbeite) {
      form.setFieldsValue({
        label: bearbeite.label,
        kategorie: bearbeite.kategorie,
        farbe: bearbeite.farbe ?? undefined,
        sortier: bearbeite.sortier,
      });
    } else {
      form.resetFields();
      form.setFieldsValue({ kategorie: 'gebunden', sortier: 0 });
    }
  }, [modalOffen, bearbeite, form]);

  const spalten: TableColumnsType<PersonalStatus> = [
    { title: 'Label', dataIndex: 'label', key: 'label' },
    {
      title: 'Kategorie',
      dataIndex: 'kategorie',
      key: 'kategorie',
      render: (k: StatusKategorie) => <Tag color={KATEGORIE_FARBEN[k]}>{KATEGORIE_LABELS[k]}</Tag>,
    },
    { title: 'Farbe', dataIndex: 'farbe', key: 'farbe', render: (f) => f ?? '—' },
    { title: 'Sortierung', dataIndex: 'sortier', key: 'sortier' },
    ...(istAdmin
      ? ([
          {
            title: 'Aktionen',
            key: 'aktionen',
            render: (_, s: PersonalStatus) => (
              <Space>
                <Button size="small" onClick={() => { setBearbeite(s); setModalOffen(true); }}>Bearbeiten</Button>
                <Popconfirm title="Status deaktivieren?" onConfirm={() => deaktivieren.mutate(s.id)}>
                  <Button size="small" danger>Deaktivieren</Button>
                </Popconfirm>
              </Space>
            ),
          },
        ] as TableColumnsType<PersonalStatus>)
      : []),
  ];

  return (
    <>
      {istAdmin && (
        <Button type="primary" style={{ marginBottom: 12 }} onClick={() => { setBearbeite(null); setModalOffen(true); }}>
          Status anlegen
        </Button>
      )}
      <Table
        rowKey="id"
        loading={statusQuery.isLoading}
        dataSource={statusQuery.data ?? []}
        columns={spalten}
        pagination={false}
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
              options={(Object.keys(KATEGORIE_LABELS) as StatusKategorie[]).map((k) => ({
                value: k, label: KATEGORIE_LABELS[k],
              }))}
            />
          </Form.Item>
          <Form.Item label="Farbe (Hex, optional)" name="farbe">
            <Input placeholder="#22aa55" />
          </Form.Item>
          <Form.Item label="Sortierung" name="sortier">
            <InputNumber min={0} style={{ width: 120 }} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
