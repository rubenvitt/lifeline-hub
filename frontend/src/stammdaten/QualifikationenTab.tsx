import {
  App, Button, Form, Input, InputNumber, Modal, Popconfirm, Space,
  type TableColumnsType,
} from 'antd';
import KatalogTabelle from '../components/KatalogTabelle';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';
import {
  aktualisiereQualifikation, deaktiviereQualifikation, legeQualifikationAn,
  listeQualifikationen, type QualifikationEingabe,
} from '../api/qualifikationen';
import type { Qualifikation } from '../api/types';
import { globalKeys } from '../api/queryKeys';

interface FormWerte {
  label: string;
  sortier: number;
}

export default function QualifikationenTab() {
  const { benutzer } = useAuth();
  const istAdmin = benutzer?.system_rolle === 'admin';
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [form] = Form.useForm<FormWerte>();
  const [modalOffen, setModalOffen] = useState(false);
  const [bearbeite, setBearbeite] = useState<Qualifikation | null>(null);

  const query = useQuery({ queryKey: globalKeys.qualifikationen(), queryFn: listeQualifikationen });

  const speichern = useMutation({
    mutationFn: (werte: FormWerte) => {
      const daten: QualifikationEingabe = { label: werte.label.trim(), sortier: werte.sortier ?? 0 };
      return bearbeite ? aktualisiereQualifikation(bearbeite.id, daten) : legeQualifikationAn(daten);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: globalKeys.qualifikationen() }); setModalOffen(false); },
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Speichern fehlgeschlagen'),
  });

  const deaktivieren = useMutation({
    mutationFn: (id: number) => deaktiviereQualifikation(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: globalKeys.qualifikationen() }),
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Deaktivieren fehlgeschlagen'),
  });

  useEffect(() => {
    if (!modalOffen) return;
    if (bearbeite) {
      form.setFieldsValue({ label: bearbeite.label, sortier: bearbeite.sortier });
    } else {
      form.resetFields();
      form.setFieldsValue({ sortier: 0 });
    }
  }, [modalOffen, bearbeite, form]);

  const spalten: TableColumnsType<Qualifikation> = [
    { title: 'Label', dataIndex: 'label', key: 'label' },
    { title: 'Sortierung', dataIndex: 'sortier', key: 'sortier' },
    ...(istAdmin
      ? ([
          {
            title: 'Aktionen',
            key: 'aktionen',
            render: (_, q: Qualifikation) => (
              <Space>
                <Button size="small" onClick={() => { setBearbeite(q); setModalOffen(true); }}>Bearbeiten</Button>
                <Popconfirm title="Qualifikation deaktivieren?" onConfirm={() => deaktivieren.mutate(q.id)}>
                  <Button size="small" danger>Deaktivieren</Button>
                </Popconfirm>
              </Space>
            ),
          },
        ] as TableColumnsType<Qualifikation>)
      : []),
  ];

  return (
    <>
      {istAdmin && (
        <Button
          type="primary"
          style={{ marginBottom: 12 }}
          onClick={() => { setBearbeite(null); setModalOffen(true); }}
        >
          Qualifikation anlegen
        </Button>
      )}
      <KatalogTabelle
        rowKey="id"
        loading={query.isLoading}
        dataSource={query.data ?? []}
        columns={spalten}
        pagination={false}
        locale={{ emptyText: 'Keine Qualifikationen' }}
      />
      <Modal
        open={modalOffen}
        title={bearbeite ? 'Qualifikation bearbeiten' : 'Qualifikation anlegen'}
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
          <Form.Item label="Sortierung" name="sortier">
            <InputNumber min={0} style={{ width: '100%', maxWidth: 120 }} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
