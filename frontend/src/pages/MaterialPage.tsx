import {
  Alert, App, Breadcrumb, Button, Form, Input, InputNumber, Modal, Popconfirm, Select, Space,
  Spin, Table, Tag, Typography, type TableColumnsType,
} from 'antd';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { ladeEinsatz } from '../api/einsaetze';
import { listeMaterial } from '../api/material';
import {
  aktualisiereDisposition, disponiereAdhoc, disponiereMaterial, entferneDisposition,
  listeEinsatzMaterial, type MaterialAdhocEingabe,
} from '../api/einsatzMaterial';
import { ApiError } from '../api/client';
import type { EinsatzMaterial, MaterialStatus } from '../api/types';

const STATUS_META: Record<MaterialStatus, { label: string; color: string }> = {
  einsatzbereit: { label: 'einsatzbereit', color: 'green' },
  im_einsatz: { label: 'im Einsatz', color: 'blue' },
  defekt: { label: 'defekt', color: 'red' },
  verbraucht: { label: 'verbraucht', color: 'default' },
  desinfektion_noetig: { label: 'Desinfektion nötig', color: 'orange' },
};
const STATUS_OPTIONEN = (Object.keys(STATUS_META) as MaterialStatus[]).map((s) => ({
  value: s, label: STATUS_META[s].label,
}));

/** Inline-Mengen-Editor: lokaler Zustand, committet erst bei Blur/Enter (min 1). */
function MengeZelle({ em, onChange }: { em: EinsatzMaterial; onChange: (menge: number) => void }) {
  const [wert, setWert] = useState<number>(em.menge);
  const pendingRef = useRef(false);
  useEffect(() => { setWert(em.menge); pendingRef.current = false; }, [em.menge]);
  const commit = () => {
    if (pendingRef.current || wert < 1 || wert === em.menge) return;
    pendingRef.current = true;
    onChange(wert);
  };
  return (
    <InputNumber
      size="small" min={1} style={{ width: 80 }} value={wert}
      onChange={(v) => setWert(v ?? 1)}
      onBlur={commit}
      onPressEnter={commit}
    />
  );
}

export default function MaterialPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [adhocOffen, setAdhocOffen] = useState(false);
  const [form] = Form.useForm<MaterialAdhocEingabe & { menge: number }>();
  const [poolAuswahl, setPoolAuswahl] = useState<number | null>(null);
  const [poolMenge, setPoolMenge] = useState<number>(1);

  const einsatzQuery = useQuery({ queryKey: ['einsatz', einsatzId], queryFn: () => ladeEinsatz(einsatzId) });
  const emQuery = useQuery({
    queryKey: ['einsatz-material', einsatzId],
    queryFn: () => listeEinsatzMaterial(einsatzId),
  });
  const poolQuery = useQuery({ queryKey: ['material', 'im-dienst'], queryFn: () => listeMaterial(true) });

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['einsatz-material', einsatzId] });
    qc.invalidateQueries({ queryKey: ['etb', einsatzId] });
  }
  const fehler = (e: unknown) => message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen');

  const disponiereMutation = useMutation({
    mutationFn: (v: { materialId: number; menge: number }) => disponiereMaterial(einsatzId, v.materialId, v.menge),
    onSuccess: () => { invalidate(); setPoolAuswahl(null); setPoolMenge(1); },
    onError: fehler,
  });
  const adhocMutation = useMutation({
    mutationFn: (w: MaterialAdhocEingabe & { menge: number }) =>
      disponiereAdhoc(einsatzId, {
        bezeichnung: w.bezeichnung, kategorie: w.kategorie, bestandsnummer: w.bestandsnummer,
        traegerorganisation: w.traegerorganisation,
      }, w.menge ?? 1),
    onSuccess: () => { invalidate(); setAdhocOffen(false); form.resetFields(); },
    onError: fehler,
  });
  const mengeMutation = useMutation({
    mutationFn: (v: { emId: number; menge: number }) => aktualisiereDisposition(einsatzId, v.emId, { menge: v.menge }),
    onSuccess: invalidate, onError: fehler,
  });
  const statusMutation = useMutation({
    mutationFn: (v: { emId: number; status: MaterialStatus }) =>
      aktualisiereDisposition(einsatzId, v.emId, { status: v.status }),
    onSuccess: invalidate, onError: fehler,
  });
  const bemerkungMutation = useMutation({
    mutationFn: (v: { emId: number; bemerkung: string }) =>
      aktualisiereDisposition(einsatzId, v.emId, { bemerkung: v.bemerkung }),
    onSuccess: invalidate, onError: fehler,
  });
  const entfernenMutation = useMutation({
    mutationFn: (emId: number) => entferneDisposition(einsatzId, emId),
    onSuccess: invalidate, onError: fehler,
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

  const ems = emQuery.data ?? [];
  // Kein Dedup wie bei Fahrzeugen: dieselbe Material-Art darf mehrfach (als getrennte
  // Position) disponiert werden (Mengen-Splitting auf Einheiten).
  const poolOptionen = (poolQuery.data ?? []).map((m) => ({
    value: m.id, label: `${m.bezeichnung}${m.kategorie ? ` (${m.kategorie})` : ''}`,
  }));

  const spalten: TableColumnsType<EinsatzMaterial> = [
    {
      title: 'Bezeichnung',
      key: 'bezeichnung',
      render: (_, em) => (
        <Space>
          {em.bezeichnung}
          {em.ist_adhoc && <Tag color="blue">ad-hoc</Tag>}
        </Space>
      ),
    },
    { title: 'Kategorie', dataIndex: 'kategorie', key: 'kategorie', render: (t) => t ?? '—' },
    {
      title: 'Menge',
      key: 'menge',
      render: (_, em) =>
        darfSchreiben
          ? <MengeZelle em={em} onChange={(menge) => mengeMutation.mutate({ emId: em.id, menge })} />
          : em.menge,
    },
    {
      title: 'Status',
      key: 'status',
      render: (_, em) =>
        darfSchreiben ? (
          <Select
            size="small"
            style={{ minWidth: 170 }}
            value={em.status}
            options={STATUS_OPTIONEN}
            onChange={(status) => statusMutation.mutate({ emId: em.id, status })}
          />
        ) : (
          <Tag color={STATUS_META[em.status].color}>{STATUS_META[em.status].label}</Tag>
        ),
    },
    {
      title: 'Bemerkung',
      key: 'bemerkung',
      render: (_, em) =>
        darfSchreiben ? (
          <Typography.Text editable={{ onChange: (val) => bemerkungMutation.mutate({ emId: em.id, bemerkung: val }) }}>
            {em.bemerkung ?? ''}
          </Typography.Text>
        ) : (
          em.bemerkung || '—'
        ),
    },
    ...(darfSchreiben
      ? ([
          {
            title: 'Aktionen',
            key: 'aktionen',
            render: (_, em: EinsatzMaterial) => (
              <Popconfirm title="Aus Einsatz entfernen?" onConfirm={() => entfernenMutation.mutate(em.id)}>
                <Button size="small" danger>Entfernen</Button>
              </Popconfirm>
            ),
          },
        ] as TableColumnsType<EinsatzMaterial>)
      : []),
  ];

  return (
    <div>
      <Breadcrumb
        style={{ marginBottom: 12 }}
        items={[{ title: <Link to="/einsaetze">Einsätze</Link> }, { title: einsatz.bezeichnung }, { title: 'Material' }]}
      />
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }}>
        <Space>
          <Typography.Title level={3} style={{ margin: 0 }}>Material</Typography.Title>
          <Tag color={einsatz.status === 'aktiv' ? 'green' : 'default'}>{einsatz.status}</Tag>
        </Space>
        {darfSchreiben && (
          <Space>
            <Select
              showSearch
              style={{ minWidth: 260 }}
              placeholder="Stamm-Material wählen …"
              value={poolAuswahl}
              options={poolOptionen}
              optionFilterProp="label"
              notFoundContent="Kein Material im Dienst"
              onChange={(v) => setPoolAuswahl(v ?? null)}
            />
            <InputNumber min={1} value={poolMenge} onChange={(v) => setPoolMenge(v ?? 1)} />
            <Button
              type="primary"
              disabled={poolAuswahl == null}
              loading={disponiereMutation.isPending}
              onClick={() => { if (poolAuswahl != null) disponiereMutation.mutate({ materialId: poolAuswahl, menge: poolMenge }); }}
            >
              Disponieren
            </Button>
            <Button onClick={() => setAdhocOffen(true)}>Ad-hoc-Material</Button>
          </Space>
        )}
      </Space>

      {!darfSchreiben && einsatz.status !== 'aktiv' && (
        <Alert style={{ marginBottom: 12 }} type="info" showIcon message="Einsatz ist abgeschlossen — nur Ansicht." />
      )}

      <Table
        rowKey="id"
        loading={emQuery.isLoading}
        dataSource={ems}
        columns={spalten}
        pagination={false}
        locale={{ emptyText: 'Noch kein Material disponiert' }}
      />

      <Modal
        open={adhocOffen}
        title="Ad-hoc-Material disponieren"
        okText="Disponieren"
        confirmLoading={adhocMutation.isPending}
        onOk={() => form.submit()}
        onCancel={() => setAdhocOffen(false)}
        destroyOnClose
      >
        <Form form={form} layout="vertical" initialValues={{ menge: 1 }} onFinish={(w) => adhocMutation.mutate(w)}>
          <Form.Item label="Bezeichnung" name="bezeichnung" rules={[{ required: true, whitespace: true }]}>
            <Input placeholder="z. B. Spende-Decken" />
          </Form.Item>
          <Form.Item label="Kategorie" name="kategorie"><Input /></Form.Item>
          <Form.Item label="Bestandsnummer" name="bestandsnummer"><Input /></Form.Item>
          <Form.Item label="Trägerorganisation" name="traegerorganisation"><Input placeholder="z. B. THW" /></Form.Item>
          <Form.Item label="Menge" name="menge" rules={[{ required: true }]}>
            <InputNumber min={1} style={{ width: 120 }} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
