import { Alert, App, Breadcrumb, Button, Form, Input, Modal, Select, Space, Spin, Table, Tabs, Tag, Typography, type TableColumnsType } from 'antd';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ladeEinsatz } from '../api/einsaetze';
import { legeTierAn, listeTiere, tierRegistrierAnzeige, type TierEingabe } from '../api/einsatzTier';
import { ApiError } from '../api/client';
import { einsatzKeys } from '../api/queryKeys';
import { tiereDetailPfad } from '../routing/deeplinks';
import type { Spezies, Tier, TierStatus } from '../api/types';

const STATUS_META: Record<TierStatus, { label: string; color: string }> = {
  aktiv: { label: 'aktiv', color: 'green' },
  vermisst: { label: 'vermisst', color: 'orange' },
  abgeschlossen: { label: 'abgeschlossen', color: 'default' },
};

const SPEZIES_META: Record<Spezies, string> = {
  hund: 'Hund', katze: 'Katze', grosstier: 'Großtier', nutzgefluegel: 'Nutzgeflügel',
  kleintier: 'Kleintier', wildtier: 'Wildtier', sonstige: 'Sonstige',
};
const SPEZIES_KEYS = Object.keys(SPEZIES_META) as Spezies[];

/** Status-Sichten: 'alle' = kein Filter; sonst Status-Filter. */
type Sicht = 'aktiv' | 'vermisst' | 'abgeschlossen' | 'alle';
const SICHTEN: { key: Sicht; label: string }[] = [
  { key: 'aktiv', label: 'Aktiv' },
  { key: 'vermisst', label: 'Vermisst' },
  { key: 'abgeschlossen', label: 'Abgeschlossen' },
  { key: 'alle', label: 'Alle' },
];

/** Halter-Kurzanzeige für die Liste. */
function halterAnzeige(t: Tier): React.ReactNode {
  if (t.halter_registrier_nr != null) {
    const label = `R-${String(t.halter_registrier_nr).padStart(3, '0')}`;
    return t.halter_storniert_at
      ? <Typography.Text type="secondary">Halter (storniert): {label}</Typography.Text>
      : <Tag color="blue">{label}</Tag>;
  }
  if (t.halter_kontakt) return <Typography.Text>{t.halter_kontakt}</Typography.Text>;
  return <Typography.Text type="secondary">unbekannt</Typography.Text>;
}

export default function TierePage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const navigate = useNavigate();
  const [sicht, setSicht] = useState<Sicht>('aktiv');
  const [speziesFilter, setSpeziesFilter] = useState<Spezies | undefined>(undefined);

  // Tier-Liste wird über den konsolidierten Einsatz-Live-Stream (useEinsatzLiveStream
  // im EinsatzLayout, `tier`-Event → 'einsatz-tiere') live gehalten — LFH-75.
  const einsatzQuery = useQuery({ queryKey: einsatzKeys.einsatz(einsatzId), queryFn: () => ladeEinsatz(einsatzId) });
  const tiereQuery = useQuery({ queryKey: einsatzKeys.tiere(einsatzId), queryFn: () => listeTiere(einsatzId) });

  const qc = useQueryClient();
  const { message } = App.useApp();
  const [modus, setModus] = useState<null | 'schnell' | 'vermisst'>(null);
  const [form] = Form.useForm<TierEingabe>();

  function invalidate() {
    qc.invalidateQueries({ queryKey: einsatzKeys.tiere(einsatzId) });
    qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
  }
  const fehler = (e: unknown) => message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen');

  const anlegenMutation = useMutation({
    mutationFn: (v: TierEingabe) => legeTierAn(einsatzId, v),
    onSuccess: () => { invalidate(); setModus(null); form.resetFields(); },
    onError: fehler,
  });

  if (einsatzQuery.isLoading) {
    return <div style={{ textAlign: 'center', paddingTop: 80 }}><Spin size="large" /></div>;
  }
  if (einsatzQuery.isError || !einsatzQuery.data) {
    return <Alert type="error" title="Einsatz nicht gefunden oder kein Zugriff" showIcon />;
  }
  const einsatz = einsatzQuery.data;
  const darfSchreiben =
    einsatz.status === 'aktiv' &&
    (einsatz.meine_rolle === 'einsatzleitung' || einsatz.meine_rolle === 'fuehrungspersonal');

  const alle = tiereQuery.data ?? [];
  const tiere = alle
    .filter((t) => sicht === 'alle' || t.status === sicht)
    .filter((t) => !speziesFilter || t.spezies === speziesFilter);

  const spalten: TableColumnsType<Tier> = [
    {
      title: 'Reg.-Nr.', key: 'reg', width: 90,
      render: (_, t) => <Typography.Text strong>{tierRegistrierAnzeige(t.registrier_nr)}</Typography.Text>,
    },
    {
      title: 'Status', key: 'status', width: 130,
      render: (_, t) => <Tag color={STATUS_META[t.status].color}>{STATUS_META[t.status].label}</Tag>,
    },
    { title: 'Spezies', key: 'spezies', width: 120, render: (_, t) => SPEZIES_META[t.spezies] },
    {
      title: 'Rufname', key: 'rufname',
      render: (_, t) => t.rufname ?? <Typography.Text type="secondary">—</Typography.Text>,
    },
    { title: 'Rasse', dataIndex: 'rasse_beschreibung', key: 'rasse', render: (r) => r ?? '—' },
    { title: 'Halter', key: 'halter', render: (_, t) => halterAnzeige(t) },
    { title: 'Antreffort', dataIndex: 'antreff_ort', key: 'antreff_ort', render: (t) => t ?? '—' },
  ];

  return (
    <div>
      <Breadcrumb
        style={{ marginBottom: 12 }}
        items={[{ title: <Link to="/einsaetze">Einsätze</Link> }, { title: einsatz.bezeichnung }, { title: 'Tiere' }]}
      />
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }}>
        <Space>
          <Typography.Title level={3} style={{ margin: 0 }}>Tiere</Typography.Title>
          <Tag color={einsatz.status === 'aktiv' ? 'green' : 'default'}>{einsatz.status}</Tag>
        </Space>
        {darfSchreiben && (
          <Space>
            <Button type="primary" onClick={() => setModus('schnell')}>Schnellerfassung</Button>
            <Button onClick={() => setModus('vermisst')}>Vermisst melden</Button>
          </Space>
        )}
      </Space>

      <Tabs activeKey={sicht} onChange={(k) => setSicht(k as Sicht)} items={SICHTEN.map((s) => ({ key: s.key, label: s.label }))} />

      <Space wrap style={{ marginBottom: 12 }}>
        <Typography.Text type="secondary">Spezies:</Typography.Text>
        <Select<Spezies | undefined> allowClear placeholder="alle" style={{ width: 180 }}
          value={speziesFilter} onChange={(v) => setSpeziesFilter(v)}
          options={SPEZIES_KEYS.map((k) => ({ value: k, label: SPEZIES_META[k] }))} />
      </Space>

      {!darfSchreiben && einsatz.status !== 'aktiv' && (
        <Alert style={{ marginBottom: 12 }} type="info" showIcon title="Einsatz ist abgeschlossen — nur Ansicht." />
      )}

      <Table
        rowKey="id"
        loading={tiereQuery.isLoading}
        dataSource={tiere}
        columns={spalten}
        pagination={false}
        locale={{ emptyText: 'Keine Tiere in dieser Sicht' }}
        onRow={(t) => ({ onClick: () => navigate(tiereDetailPfad(einsatzId, t.id)), style: { cursor: 'pointer' } })}
      />

      <Modal
        open={modus !== null}
        title={modus === 'vermisst' ? 'Vermisst melden' : 'Schnellerfassung'}
        okText="Erfassen"
        confirmLoading={anlegenMutation.isPending}
        onOk={() => form.submit()}
        onCancel={() => { setModus(null); form.resetFields(); }}
        destroyOnHidden
      >
        <Form form={form} layout="vertical"
          initialValues={{ spezies: 'hund' }}
          onFinish={(daten) => anlegenMutation.mutate({ ...daten, status: modus === 'vermisst' ? 'vermisst' : 'aktiv' })}>
          <Form.Item label="Spezies" name="spezies" rules={[{ required: true, message: 'Bitte Spezies wählen' }]}>
            <Select options={SPEZIES_KEYS.map((k) => ({ value: k, label: SPEZIES_META[k] }))} />
          </Form.Item>
          <Form.Item label="Rufname" name="rufname"><Input /></Form.Item>
          <Form.Item label="Rasse / Beschreibung" name="rasse_beschreibung"><Input placeholder="z. B. Haflinger, Deutscher Schäferhund" /></Form.Item>
          <Form.Item label="Antreffort" name="antreff_ort"><Input placeholder="z. B. Weide, Sammelstelle" /></Form.Item>
          {modus === 'vermisst' && (
            <>
              <Form.Item label="Farbe / Erscheinung" name="farbe_beschreibung"><Input /></Form.Item>
              <Form.Item label="Kennzeichnung (Chip/Tätowierung/Halsband)" name="kennzeichnung"><Input /></Form.Item>
              <Form.Item label="Halter-Kontakt (Name, Tel.)" name="halter_kontakt"><Input placeholder="meldender Halter" /></Form.Item>
            </>
          )}
          <Form.Item label="Notiz" name="notiz"><Input.TextArea rows={2} /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
