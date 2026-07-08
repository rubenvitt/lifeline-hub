import { App, Button, Form, Input, Modal, Select, Space, Table, Tag } from 'antd';
import type { TableColumnsType } from 'antd';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import { legeBefehlAn, listeBefehle, type NeuerBefehl } from '../api/befehle';
import { einsatzKeys } from '../api/queryKeys';
import type { BefehlAnzeige } from '../api/types';
import { VORLAGEN } from '../befehle/vorlagen';
import { befehlDetailPfad } from '../routing/deeplinks';

export default function BefehlListe({ einsatzId, darfSchreiben }: { einsatzId: number; darfSchreiben: boolean }) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [anlegenOffen, setAnlegenOffen] = useState(false);
  const [form] = Form.useForm<NeuerBefehl>();

  const befehleQuery = useQuery({
    queryKey: einsatzKeys.befehle(einsatzId),
    queryFn: () => listeBefehle(einsatzId),
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: einsatzKeys.befehle(einsatzId) });
  const fehler = (e: unknown) => message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen');

  const anlegenMutation = useMutation({
    mutationFn: (daten: NeuerBefehl) => legeBefehlAn(einsatzId, daten),
    onSuccess: () => { invalidate(); setAnlegenOffen(false); form.resetFields(); },
    onError: fehler,
  });

  const spalten: TableColumnsType<BefehlAnzeige> = [
    { title: 'Titel', dataIndex: 'titel', render: (titel: string, b) => (
        <Link to={befehlDetailPfad(einsatzId, b.id)}>{titel}</Link>
      ) },
    { title: 'Schema', dataIndex: 'vorlage', render: (v: string) => VORLAGEN.find((x) => x.schluessel === v)?.label ?? v },
    { title: 'Zeitstand', dataIndex: 'zeitstand' },
    { title: 'Status', dataIndex: 'status', render: (s: string) => (
        <Tag color={s === 'freigegeben' ? 'green' : 'default'}>{s === 'freigegeben' ? 'Freigegeben' : 'Entwurf'}</Tag>
      ) },
    { title: 'Version', dataIndex: 'version' },
    { title: 'Ersteller', dataIndex: 'ersteller_name' },
  ];

  return (
    <div>
      <Space style={{ width: '100%', justifyContent: 'flex-end', marginBottom: 16 }}>
        {darfSchreiben && <Button type="primary" onClick={() => setAnlegenOffen(true)}>Befehl erteilen</Button>}
      </Space>
      <Table<BefehlAnzeige>
        rowKey="id"
        loading={befehleQuery.isLoading}
        dataSource={befehleQuery.data ?? []}
        columns={spalten}
        pagination={false}
        locale={{ emptyText: 'Noch keine Befehle' }}
      />
      <Modal
        open={anlegenOffen}
        title="Neuen Befehl anlegen"
        okText="Anlegen"
        confirmLoading={anlegenMutation.isPending}
        onOk={() => form.submit()}
        onCancel={() => setAnlegenOffen(false)}
        destroyOnHidden
      >
        <Form<NeuerBefehl> form={form} layout="vertical" initialValues={{ vorlage: 'befehl_lad' }} onFinish={(w) => anlegenMutation.mutate(w)}>
          <Form.Item label="Schema" name="vorlage" rules={[{ required: true }]}>
            <Select options={VORLAGEN.map((v) => ({ value: v.schluessel, label: v.label }))} />
          </Form.Item>
          <Form.Item label="Titel" name="titel" rules={[{ required: true, message: 'Titel erforderlich' }]}>
            <Input placeholder="z. B. Befehl an 2. Zug 10:30" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
