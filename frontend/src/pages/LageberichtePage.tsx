import { App, Breadcrumb, Button, Form, Input, Modal, Space, Spin, Table, Tag, Typography } from 'antd';
import { Select } from '../components/Select';
import type { TableColumnsType } from 'antd';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { lageberichtDetailPfad } from '../routing/deeplinks';
import { ladeEinsatz } from '../api/einsaetze';
import { ApiError } from '../api/client';
import { einsatzKeys } from '../api/queryKeys';
import { legeLageberichtAn, listeLageberichte, type NeuerLagebericht } from '../api/lageberichte';
import type { LageberichtAnzeige } from '../api/types';
import { VORLAGEN } from '../lageberichte/vorlagen';

export default function LageberichtePage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [anlegenOffen, setAnlegenOffen] = useState(false);
  const [form] = Form.useForm<NeuerLagebericht>();


  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const berichteQuery = useQuery({
    queryKey: einsatzKeys.lageberichte(einsatzId),
    queryFn: () => listeLageberichte(einsatzId),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: einsatzKeys.lageberichte(einsatzId) });
  const fehler = (e: unknown) =>
    message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen');

  const anlegenMutation = useMutation({
    mutationFn: (daten: NeuerLagebericht) => legeLageberichtAn(einsatzId, daten),
    onSuccess: () => {
      invalidate();
      setAnlegenOffen(false);
      form.resetFields();
    },
    onError: fehler,
  });

  if (einsatzQuery.isLoading) {
    return (
      <div style={{ textAlign: 'center', paddingTop: 80 }}>
        <Spin size="large" />
      </div>
    );
  }
  if (einsatzQuery.isError || !einsatzQuery.data) {
    return <Typography.Text type="danger">Einsatz nicht gefunden oder kein Zugriff.</Typography.Text>;
  }
  const einsatz = einsatzQuery.data;
  const darfSchreiben =
    einsatz.status === 'aktiv' &&
    (einsatz.meine_rolle === 'einsatzleitung' || einsatz.meine_rolle === 'fuehrungspersonal');

  const berichte = berichteQuery.data ?? [];

  const spalten: TableColumnsType<LageberichtAnzeige> = [
    {
      title: 'Titel',
      dataIndex: 'titel',
      render: (titel: string, lb) => (
        <Link to={lageberichtDetailPfad(einsatzId, lb.id)}>{titel}</Link>
      ),
    },
    {
      title: 'Vorlage',
      dataIndex: 'vorlage',
      render: (v: string) => VORLAGEN.find((x) => x.schluessel === v)?.label ?? v,
    },
    { title: 'Zeitstand', dataIndex: 'zeitstand' },
    {
      title: 'Status',
      dataIndex: 'status',
      render: (s: string) => (
        <Tag color={s === 'freigegeben' ? 'green' : 'default'}>
          {s === 'freigegeben' ? 'Freigegeben' : 'Entwurf'}
        </Tag>
      ),
    },
    { title: 'Version', dataIndex: 'version' },
    { title: 'Ersteller', dataIndex: 'ersteller_name' },
  ];

  return (
    <div>
      <Breadcrumb
        style={{ marginBottom: 12 }}
        items={[
          { title: <Link to="/einsaetze">Einsätze</Link> },
          { title: einsatz.bezeichnung },
          { title: 'Lageberichte' },
        ]}
      />
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          Lageberichte
        </Typography.Title>
        {darfSchreiben && (
          <Button type="primary" onClick={() => setAnlegenOffen(true)}>
            Neuer Bericht
          </Button>
        )}
      </Space>

      <Table<LageberichtAnzeige>
        rowKey="id"
        loading={berichteQuery.isLoading}
        dataSource={berichte}
        columns={spalten}
        pagination={false}
        locale={{ emptyText: 'Noch keine Lageberichte' }}
      />

      <Modal
        open={anlegenOffen}
        title="Neuer Lagebericht"
        okText="Anlegen"
        confirmLoading={anlegenMutation.isPending}
        onOk={() => form.submit()}
        onCancel={() => setAnlegenOffen(false)}
        destroyOnHidden
      >
        <Form<NeuerLagebericht>
          form={form}
          layout="vertical"
          initialValues={{ vorlage: 'lagebericht' }}
          onFinish={(w) => anlegenMutation.mutate(w)}
        >
          <Form.Item label="Vorlage" name="vorlage" rules={[{ required: true }]}>
            <Select options={VORLAGEN.map((v) => ({ value: v.schluessel, label: v.label }))} />
          </Form.Item>
          <Form.Item label="Titel" name="titel" rules={[{ required: true, message: 'Titel erforderlich' }]}>
            <Input placeholder="z. B. Lageüberblick 10:30 Uhr" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
