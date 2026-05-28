import { Alert, App, Breadcrumb, Button, Drawer, Form, Input, Select, Space, Spin, Table, Tag, Typography, type TableColumnsType } from 'antd';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ladeEinsatz } from '../api/einsaetze';
import { legeUhsAn, listeUhs, type UhsEingabe } from '../api/einsatzUhs';
import { ApiError } from '../api/client';
import { useUhsStream } from '../etb/useUhsStream';
import type { Uhs, UhsStatus, UhsTyp } from '../api/types';
import UhsDetailDrawer from './uhs/UhsDetailDrawer';

const UHS_TYP_LABEL: Record<UhsTyp, string> = {
  patientenablage: 'Patientenablage',
  behandlungsplatz: 'Behandlungsplatz',
  verletztensammelstelle: 'Verletztensammelstelle',
  bereitstellungsraum: 'Bereitstellungsraum',
  sonstige: 'Sonstige',
};

const STATUS_META: Record<UhsStatus, { label: string; color: string }> = {
  geplant: { label: 'geplant', color: 'default' },
  aktiv: { label: 'aktiv', color: 'green' },
  aufgeloest: { label: 'aufgelöst', color: 'red' },
};

export default function UnfallhilfsstellenPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  useUhsStream(einsatzId);

  const einsatzQuery = useQuery({ queryKey: ['einsatz', einsatzId], queryFn: () => ladeEinsatz(einsatzId) });
  const uhsQuery = useQuery({
    queryKey: ['einsatz-uhs', einsatzId],
    queryFn: () => listeUhs(einsatzId),
  });

  const qc = useQueryClient();
  const { message } = App.useApp();
  const [anlegen, setAnlegen] = useState(false);
  const [form] = Form.useForm<UhsEingabe>();
  const [aktivId, setAktivId] = useState<number | null>(null);

  const ist_aktiv = einsatzQuery.data?.status === 'aktiv';
  const ist_beobachter = einsatzQuery.data?.meine_rolle === 'beobachter';
  const schreibgeschuetzt = !ist_aktiv || ist_beobachter;

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['einsatz-uhs', einsatzId] });
    qc.invalidateQueries({ queryKey: ['etb', einsatzId] });
  }
  const fehler = (e: unknown) => message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen');

  const anlegenMut = useMutation({
    mutationFn: (daten: UhsEingabe) => legeUhsAn(einsatzId, daten),
    onSuccess: () => { message.success('UHS angelegt'); invalidate(); setAnlegen(false); form.resetFields(); },
    onError: fehler,
  });

  const spalten: TableColumnsType<Uhs> = [
    { title: 'Bezeichnung', dataIndex: 'bezeichnung', render: (b: string, u) =>
        <Button type="link" onClick={() => setAktivId(u.id)}>{b}</Button> },
    { title: 'Typ', dataIndex: 'typ', render: (t: UhsTyp) => UHS_TYP_LABEL[t] },
    { title: 'Status', dataIndex: 'status', render: (s: UhsStatus) => {
      const meta = STATUS_META[s];
      return <Tag color={meta.color}>{meta.label}</Tag>;
    }},
    { title: 'Standort', dataIndex: 'standort', render: (s: string | null) => s ?? '—' },
  ];

  if (einsatzQuery.isLoading || uhsQuery.isLoading) return <Spin />;
  if (einsatzQuery.error) return <Alert type="error" message="Einsatz konnte nicht geladen werden" />;

  return (
    <div style={{ padding: 16 }}>
      <Breadcrumb items={[
        { title: <Link to="/einsaetze">Einsätze</Link> },
        { title: <Link to={`/einsaetze/${einsatzId}`}>{einsatzQuery.data?.bezeichnung}</Link> },
        { title: 'Unfallhilfsstellen' },
      ]} />
      <Space style={{ marginTop: 12, marginBottom: 12 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>Unfallhilfsstellen</Typography.Title>
        <Button type="primary" disabled={schreibgeschuetzt} onClick={() => setAnlegen(true)}>Neu</Button>
      </Space>
      <Table<Uhs>
        rowKey="id"
        dataSource={uhsQuery.data ?? []}
        columns={spalten}
        size="middle"
        pagination={false}
      />

      <Drawer
        title="Unfallhilfsstelle anlegen"
        open={anlegen}
        onClose={() => setAnlegen(false)}
        width={420}
        destroyOnClose
      >
        <Form<UhsEingabe>
          form={form}
          layout="vertical"
          onFinish={(v) => anlegenMut.mutate(v)}
          initialValues={{ typ: 'behandlungsplatz' }}
        >
          <Form.Item label="Typ" name="typ" rules={[{ required: true }]}>
            <Select options={Object.entries(UHS_TYP_LABEL).map(([v, l]) => ({ value: v, label: l }))} />
          </Form.Item>
          <Form.Item label="Bezeichnung" name="bezeichnung" rules={[{ required: true, message: 'Bezeichnung erforderlich' }]}>
            <Input placeholder="z. B. BHP 50" />
          </Form.Item>
          <Form.Item label="Standort (optional)" name="standort">
            <Input placeholder="Adresse / Hinweis" />
          </Form.Item>
          <Form.Item label="Notiz (optional)" name="notiz">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={anlegenMut.isPending}>Anlegen</Button>
        </Form>
      </Drawer>

      {aktivId != null && (
        <UhsDetailDrawer
          einsatzId={einsatzId}
          uhsId={aktivId}
          schreibgeschuetzt={schreibgeschuetzt}
          onClose={() => setAktivId(null)}
        />
      )}
    </div>
  );
}
