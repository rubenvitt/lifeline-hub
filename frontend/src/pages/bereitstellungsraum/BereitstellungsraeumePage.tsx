import {
  Alert, App, Breadcrumb, Button, Drawer, Form, Input, Space,
  Spin, Table, Tag, Typography, type TableColumnsType,
} from 'antd';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { bereitstellungsraumDetailPfad } from '../../routing/deeplinks';
import { ladeEinsatz } from '../../api/einsaetze';
import { listeBr, legeBrAn, type BrEingabe } from '../../api/einsatzBereitstellungsraum';
import { ApiError } from '../../api/client';
import type { Bereitstellungsraum, BrStatus } from '../../api/types';

const STATUS_META: Record<BrStatus, { label: string; color: string }> = {
  geplant: { label: 'geplant', color: 'default' },
  aktiv: { label: 'aktiv', color: 'green' },
  aufgeloest: { label: 'aufgelöst', color: 'red' },
};

export default function BereitstellungsraeumePage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { message } = App.useApp();

  const einsatzQuery = useQuery({
    queryKey: ['einsatz', einsatzId],
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const brQuery = useQuery({
    queryKey: ['einsatz-br', einsatzId],
    queryFn: () => listeBr(einsatzId),
  });

  const [anlegen, setAnlegen] = useState(false);
  const [form] = Form.useForm<BrEingabe>();

  const ist_aktiv = einsatzQuery.data?.status === 'aktiv';
  const ist_beobachter = einsatzQuery.data?.meine_rolle === 'beobachter';
  const schreibgeschuetzt = !ist_aktiv || ist_beobachter;

  const anlegenMut = useMutation({
    mutationFn: (daten: BrEingabe) => legeBrAn(einsatzId, daten),
    onSuccess: (br) => {
      message.success('Bereitstellungsraum angelegt');
      qc.invalidateQueries({ queryKey: ['einsatz-br', einsatzId] });
      qc.invalidateQueries({ queryKey: ['etb', einsatzId] });
      setAnlegen(false);
      form.resetFields();
      navigate(bereitstellungsraumDetailPfad(einsatzId, br.id));
    },
    onError: (e: unknown) =>
      message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen'),
  });

  const spalten: TableColumnsType<Bereitstellungsraum> = [
    {
      title: 'Bezeichnung',
      dataIndex: 'bezeichnung',
      render: (b: string, br) => (
        <Link to={bereitstellungsraumDetailPfad(einsatzId, br.id)}>{b}</Link>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      render: (s: BrStatus) => {
        const meta = STATUS_META[s];
        return <Tag color={meta.color}>{meta.label}</Tag>;
      },
    },
    { title: 'Standort', dataIndex: 'standort', render: (s: string | null) => s ?? '—' },
  ];

  if (einsatzQuery.isLoading || brQuery.isLoading) {
    return <div style={{ textAlign: 'center', paddingTop: 80 }}><Spin size="large" /></div>;
  }
  if (einsatzQuery.error) {
    return <Alert type="error" message="Einsatz konnte nicht geladen werden" showIcon />;
  }

  return (
    <div style={{ padding: 16 }}>
      <Breadcrumb items={[
        { title: <Link to="/einsaetze">Einsätze</Link> },
        { title: <Link to={`/einsaetze/${einsatzId}`}>{einsatzQuery.data?.bezeichnung}</Link> },
        { title: 'Bereitstellungsräume' },
      ]} />

      <Space style={{ marginTop: 12, marginBottom: 12 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>Bereitstellungsräume</Typography.Title>
        <Button type="primary" disabled={schreibgeschuetzt} onClick={() => setAnlegen(true)}>
          Neu
        </Button>
      </Space>

      <Table<Bereitstellungsraum>
        rowKey="id"
        dataSource={(brQuery.data ?? []).filter((br) => !br.storniert_at)}
        columns={spalten}
        size="middle"
        pagination={false}
        locale={{ emptyText: 'Noch keine Bereitstellungsräume erfasst' }}
      />

      <Drawer
        title="Bereitstellungsraum anlegen"
        open={anlegen}
        onClose={() => { setAnlegen(false); form.resetFields(); }}
        width={420}
        destroyOnHidden
      >
        <Form<BrEingabe>
          form={form}
          layout="vertical"
          onFinish={(v) => anlegenMut.mutate(v)}
        >
          <Form.Item
            label="Bezeichnung"
            name="bezeichnung"
            rules={[{ required: true, message: 'Bezeichnung erforderlich' }]}
          >
            <Input placeholder="z. B. BR Ost" />
          </Form.Item>
          <Form.Item label="Standort (optional)" name="standort">
            <Input placeholder="Adresse / Hinweis" />
          </Form.Item>
          <Form.Item label="Notiz (optional)" name="notiz">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={anlegenMut.isPending}>
            Anlegen
          </Button>
        </Form>
      </Drawer>
    </div>
  );
}
