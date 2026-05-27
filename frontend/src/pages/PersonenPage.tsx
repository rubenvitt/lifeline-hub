import { Alert, App, Breadcrumb, Button, Form, Input, InputNumber, Modal, Select, Space, Spin, Table, Tabs, Tag, Typography, type TableColumnsType } from 'antd';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ladeEinsatz } from '../api/einsaetze';
import { legePersonAn, listePersonen, registrierAnzeige, setzePersonStatus, type PersonEingabe } from '../api/einsatzPerson';
import { ApiError } from '../api/client';
import { usePersonenStream } from '../etb/usePersonenStream';
import type { Person, PersonStatus } from '../api/types';

const STATUS_META: Record<PersonStatus, { label: string; color: string }> = {
  erfasst: { label: 'erfasst', color: 'default' },
  vermisst: { label: 'vermisst', color: 'orange' },
  betroffen: { label: 'betroffen', color: 'blue' },
  verstorben: { label: 'verstorben', color: 'red' },
  abgemeldet: { label: 'abgemeldet', color: 'green' },
};

/** Sicht-Tabs: 'alle' = kein Filter; sonst Status-Filter. */
type Sicht = 'erfasst' | 'vermisst' | 'betroffen' | 'verstorben' | 'alle';
const SICHTEN: { key: Sicht; label: string }[] = [
  { key: 'erfasst', label: 'Neu' },
  { key: 'vermisst', label: 'Vermisst' },
  { key: 'betroffen', label: 'Betroffen' },
  { key: 'verstorben', label: 'Verstorben' },
  { key: 'alle', label: 'Alle' },
];

function alterAnzeige(p: Person): string {
  if (p.geburtsdatum) return p.geburtsdatum;
  if (p.alter_geschaetzt != null) return `~${p.alter_geschaetzt} J.`;
  return '—';
}

export default function PersonenPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const [sicht, setSicht] = useState<Sicht>('erfasst');

  usePersonenStream(einsatzId);

  const einsatzQuery = useQuery({ queryKey: ['einsatz', einsatzId], queryFn: () => ladeEinsatz(einsatzId) });
  const personenQuery = useQuery({
    queryKey: ['einsatz-personen', einsatzId],
    queryFn: () => listePersonen(einsatzId),
  });

  const qc = useQueryClient();
  const { message } = App.useApp();
  const [modus, setModus] = useState<null | 'schnell' | 'vermisst' | 'betroffen'>(null);
  const [form] = Form.useForm<PersonEingabe>();

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['einsatz-personen', einsatzId] });
    qc.invalidateQueries({ queryKey: ['etb', einsatzId] });
  }
  const fehler = (e: unknown) => message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen');

  const anlegenMutation = useMutation({
    mutationFn: async (v: { daten: PersonEingabe; folgeStatus?: 'vermisst' | 'betroffen' }) => {
      const person = await legePersonAn(einsatzId, v.daten);
      if (v.folgeStatus) await setzePersonStatus(einsatzId, person.id, v.folgeStatus);
      return person;
    },
    onSuccess: () => { invalidate(); setModus(null); form.resetFields(); },
    onError: fehler,
  });

  if (einsatzQuery.isLoading) {
    return <div style={{ textAlign: 'center', paddingTop: 80 }}><Spin size="large" /></div>;
  }
  if (einsatzQuery.isError || !einsatzQuery.data) {
    return <Alert type="error" message="Einsatz nicht gefunden oder kein Zugriff" showIcon />;
  }
  const einsatz = einsatzQuery.data;
  const darfSchreiben =
    einsatz.status === 'aktiv' &&
    (einsatz.meine_rolle === 'einsatzleitung' || einsatz.meine_rolle === 'fuehrungspersonal');

  const alle = personenQuery.data ?? [];
  const personen = sicht === 'alle' ? alle : alle.filter((p) => p.status === sicht);

  const spalten: TableColumnsType<Person> = [
    {
      title: 'Reg.-Nr.', key: 'reg', width: 100,
      render: (_, p) => <Typography.Text strong>{registrierAnzeige(p.registrier_nr)}</Typography.Text>,
    },
    {
      title: 'Status', key: 'status', width: 130,
      render: (_, p) => <Tag color={STATUS_META[p.status].color}>{STATUS_META[p.status].label}</Tag>,
    },
    {
      title: 'Name', key: 'name',
      render: (_, p) =>
        p.name || p.vorname
          ? `${p.name ?? ''}${p.vorname ? `, ${p.vorname}` : ''}`
          : <Typography.Text type="secondary">unbekannt</Typography.Text>,
    },
    { title: 'Geschlecht', dataIndex: 'geschlecht', key: 'geschlecht', render: (g) => g ?? '—' },
    { title: 'Alter', key: 'alter', render: (_, p) => alterAnzeige(p) },
    { title: 'Antreffort', dataIndex: 'antreff_ort', key: 'antreff_ort', render: (t) => t ?? '—' },
  ];

  return (
    <div>
      <Breadcrumb
        style={{ marginBottom: 12 }}
        items={[{ title: <Link to="/einsaetze">Einsätze</Link> }, { title: einsatz.bezeichnung }, { title: 'Personen' }]}
      />
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }}>
        <Space>
          <Typography.Title level={3} style={{ margin: 0 }}>Personen</Typography.Title>
          <Tag color={einsatz.status === 'aktiv' ? 'green' : 'default'}>{einsatz.status}</Tag>
        </Space>
        {darfSchreiben && (
          <Space>
            <Button type="primary" onClick={() => setModus('schnell')}>Schnellerfassung</Button>
            <Button onClick={() => setModus('vermisst')}>Vermisst melden</Button>
            <Button onClick={() => setModus('betroffen')}>Betroffene/n erfassen</Button>
          </Space>
        )}
      </Space>

      <Tabs
        activeKey={sicht}
        onChange={(k) => setSicht(k as Sicht)}
        items={SICHTEN.map((s) => ({ key: s.key, label: s.label }))}
      />

      {!darfSchreiben && einsatz.status !== 'aktiv' && (
        <Alert style={{ marginBottom: 12 }} type="info" showIcon message="Einsatz ist abgeschlossen — nur Ansicht." />
      )}

      <Table
        rowKey="id"
        loading={personenQuery.isLoading}
        dataSource={personen}
        columns={spalten}
        pagination={false}
        locale={{ emptyText: 'Keine Personen in dieser Sicht' }}
      />

      <Modal
        open={modus !== null}
        title={modus === 'vermisst' ? 'Vermisst melden' : modus === 'betroffen' ? 'Betroffene/n erfassen' : 'Schnellerfassung'}
        okText="Erfassen"
        confirmLoading={anlegenMutation.isPending}
        onOk={() => form.submit()}
        onCancel={() => { setModus(null); form.resetFields(); }}
        destroyOnClose
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={(daten) =>
            anlegenMutation.mutate({
              daten,
              folgeStatus: modus === 'vermisst' ? 'vermisst' : modus === 'betroffen' ? 'betroffen' : undefined,
            })
          }
        >
          <Form.Item label="Geschlecht" name="geschlecht">
            <Select
              allowClear
              placeholder="unbekannt"
              options={[
                { value: 'maennlich', label: 'männlich' },
                { value: 'weiblich', label: 'weiblich' },
                { value: 'divers', label: 'divers' },
                { value: 'unbekannt', label: 'unbekannt' },
              ]}
            />
          </Form.Item>
          <Form.Item label="Geschätztes Alter (Jahre)" name="alter_geschaetzt">
            <InputNumber min={0} max={120} style={{ width: 140 }} />
          </Form.Item>
          <Form.Item label="Antreffort" name="antreff_ort"><Input placeholder="z. B. Brücke, Sammelstelle" /></Form.Item>
          <Form.Item label="Name" name="name"><Input /></Form.Item>
          <Form.Item label="Vorname" name="vorname"><Input /></Form.Item>
          {modus === 'vermisst' && (
            <Form.Item label="Melder / Kontakt" name="melder_kontakt">
              <Input placeholder="Angehöriger, Kontaktdaten" />
            </Form.Item>
          )}
          <Form.Item label="Notiz" name="notiz"><Input.TextArea rows={2} /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
