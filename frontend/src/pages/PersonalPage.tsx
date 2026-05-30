import {
  Alert, App, Breadcrumb, Button, Form, Input, Modal, Popconfirm, Select, Space, Spin,
  Table, Tag, Typography, type TableColumnsType,
} from 'antd';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ladeEinsatz } from '../api/einsaetze';
import { listePersonal } from '../api/personal';
import { listePersonalStatus } from '../api/personalStatus';
import {
  aktualisiereDisposition, disponiereAdhoc, disponierePerson, entferneDisposition,
  listeEinsatzPersonal, type AdhocEingabe,
} from '../api/einsatzPersonal';
import { ApiError } from '../api/client';
import type { EinsatzPersonal, StaerkePosition, StatusKategorie } from '../api/types';

const KATEGORIE_FALLBACK: Record<StatusKategorie, string> = {
  verfuegbar: 'green',
  gebunden: 'orange',
  nicht_verfuegbar: 'red',
};

const POSITION_LABELS: Record<StaerkePosition, string> = {
  fuehrer: 'Führer',
  unterfuehrer: 'Unterführer',
  mannschaft: 'Mannschaft',
};

const POSITION_OPTIONEN = (Object.keys(POSITION_LABELS) as StaerkePosition[]).map((p) => ({
  value: p, label: POSITION_LABELS[p],
}));

function StatusBadge({ ep }: { ep: EinsatzPersonal }) {
  if (!ep.status_label || !ep.status_kategorie) return <Tag>kein Status</Tag>;
  const farbe = ep.status_farbe ?? KATEGORIE_FALLBACK[ep.status_kategorie];
  return <Tag color={farbe}>{ep.status_label}</Tag>;
}

export default function PersonalPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [adhocOffen, setAdhocOffen] = useState(false);
  const [form] = Form.useForm<AdhocEingabe>();

  const einsatzQuery = useQuery({ queryKey: ['einsatz', einsatzId], queryFn: () => ladeEinsatz(einsatzId) });
  const epQuery = useQuery({
    queryKey: ['einsatz-personal', einsatzId],
    queryFn: () => listeEinsatzPersonal(einsatzId),
  });
  const statusQuery = useQuery({ queryKey: ['personal-status'], queryFn: listePersonalStatus });
  const poolQuery = useQuery({ queryKey: ['personal', 'im-dienst'], queryFn: () => listePersonal(true) });

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['einsatz-personal', einsatzId] });
    qc.invalidateQueries({ queryKey: ['etb', einsatzId] });
  }
  const fehler = (e: unknown) => message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen');

  const disponiereMutation = useMutation({
    mutationFn: (personalId: number) => disponierePerson(einsatzId, personalId),
    onSuccess: invalidate,
    onError: fehler,
  });
  const adhocMutation = useMutation({
    mutationFn: (daten: AdhocEingabe) => disponiereAdhoc(einsatzId, daten),
    onSuccess: () => { invalidate(); setAdhocOffen(false); form.resetFields(); },
    onError: fehler,
  });
  const statusMutation = useMutation({
    mutationFn: (v: { epId: number; statusId: number }) =>
      aktualisiereDisposition(einsatzId, v.epId, { status_id: v.statusId }),
    onSuccess: invalidate,
    onError: fehler,
  });
  const positionMutation = useMutation({
    mutationFn: (v: { epId: number; position: StaerkePosition }) =>
      aktualisiereDisposition(einsatzId, v.epId, { staerke_position: v.position }),
    onSuccess: invalidate,
    onError: fehler,
  });
  const bemerkungMutation = useMutation({
    mutationFn: (v: { epId: number; bemerkung: string }) =>
      aktualisiereDisposition(einsatzId, v.epId, { bemerkung: v.bemerkung }),
    onSuccess: invalidate,
    onError: fehler,
  });
  const entfernenMutation = useMutation({
    mutationFn: (epId: number) => entferneDisposition(einsatzId, epId),
    onSuccess: invalidate,
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

  const eps = epQuery.data ?? [];
  const stati = statusQuery.data ?? [];
  const disponierteIds = new Set(eps.map((e) => e.personal_id).filter((x): x is number => x != null));
  const poolOptionen = (poolQuery.data ?? [])
    .filter((p) => !disponierteIds.has(p.id))
    .map((p) => ({ value: p.id, label: `${p.name}${p.personalnummer ? ` (${p.personalnummer})` : ''}` }));

  const spalten: TableColumnsType<EinsatzPersonal> = [
    {
      title: 'Name',
      key: 'name',
      render: (_, ep) => (
        <Space>
          {ep.name}
          {ep.ist_adhoc && <Tag color="blue">ad-hoc</Tag>}
        </Space>
      ),
    },
    { title: 'Funktion', dataIndex: 'funktion', key: 'funktion', render: (t) => t ?? '—' },
    { title: 'Träger', dataIndex: 'traegerorganisation', key: 'traeger', render: (t) => t ?? '—' },
    {
      title: 'Position',
      key: 'position',
      render: (_, ep) =>
        darfSchreiben ? (
          <Select
            size="small"
            style={{ minWidth: 130 }}
            value={ep.staerke_position ?? undefined}
            placeholder="—"
            options={POSITION_OPTIONEN}
            onChange={(position) => positionMutation.mutate({ epId: ep.id, position })}
          />
        ) : (
          ep.staerke_position ? POSITION_LABELS[ep.staerke_position] : '—'
        ),
    },
    {
      title: 'Status',
      key: 'status',
      render: (_, ep) =>
        darfSchreiben ? (
          <Select
            size="small"
            style={{ minWidth: 150 }}
            value={ep.status_id ?? undefined}
            placeholder="Status wählen"
            options={stati.map((s) => ({ value: s.id, label: s.label }))}
            onChange={(statusId) => statusMutation.mutate({ epId: ep.id, statusId })}
          />
        ) : (
          <StatusBadge ep={ep} />
        ),
    },
    {
      title: 'Bemerkung',
      key: 'bemerkung',
      render: (_, ep) =>
        darfSchreiben ? (
          <Typography.Text
            editable={{ onChange: (val) => bemerkungMutation.mutate({ epId: ep.id, bemerkung: val }) }}
          >
            {ep.bemerkung ?? ''}
          </Typography.Text>
        ) : (
          ep.bemerkung || '—'
        ),
    },
    ...(darfSchreiben
      ? ([
          {
            title: 'Aktionen',
            key: 'aktionen',
            render: (_, ep: EinsatzPersonal) => (
              <Popconfirm title="Aus Einsatz entfernen?" onConfirm={() => entfernenMutation.mutate(ep.id)}>
                <Button size="small" danger>Entfernen</Button>
              </Popconfirm>
            ),
          },
        ] as TableColumnsType<EinsatzPersonal>)
      : []),
  ];

  return (
    <div>
      <Breadcrumb
        style={{ marginBottom: 12 }}
        items={[{ title: <Link to="/einsaetze">Einsätze</Link> }, { title: einsatz.bezeichnung }, { title: 'Personal' }]}
      />
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }}>
        <Space>
          <Typography.Title level={3} style={{ margin: 0 }}>Personal</Typography.Title>
          <Tag color={einsatz.status === 'aktiv' ? 'green' : 'default'}>{einsatz.status}</Tag>
        </Space>
        {darfSchreiben && (
          <Space>
            <Select
              showSearch
              style={{ minWidth: 260 }}
              placeholder="Person aus Pool disponieren …"
              value={null}
              options={poolOptionen}
              optionFilterProp="label"
              notFoundContent="Keine freien Personen"
              onSelect={(personalId) => { if (personalId != null) disponiereMutation.mutate(personalId); }}
            />
            <Button onClick={() => setAdhocOffen(true)}>Ad-hoc-Person</Button>
          </Space>
        )}
      </Space>

      {!darfSchreiben && einsatz.status !== 'aktiv' && (
        <Alert style={{ marginBottom: 12 }} type="info" showIcon message="Einsatz ist abgeschlossen — nur Ansicht." />
      )}

      <Table
        rowKey="id"
        loading={epQuery.isLoading}
        dataSource={eps}
        columns={spalten}
        pagination={false}
        locale={{ emptyText: 'Noch kein Personal disponiert' }}
      />

      <Modal
        open={adhocOffen}
        title="Ad-hoc-Person disponieren"
        okText="Disponieren"
        confirmLoading={adhocMutation.isPending}
        onOk={() => form.submit()}
        onCancel={() => setAdhocOffen(false)}
        destroyOnHidden
      >
        <Form<AdhocEingabe> form={form} layout="vertical" onFinish={(w) => adhocMutation.mutate(w)}>
          <Form.Item label="Name" name="name" rules={[{ required: true, whitespace: true }]}>
            <Input placeholder="z. B. Dr. Schmidt" />
          </Form.Item>
          <Form.Item label="Funktion" name="funktion"><Input placeholder="z. B. Notarzt" /></Form.Item>
          <Form.Item label="Trägerorganisation" name="traegerorganisation">
            <Input placeholder="z. B. KV Musterstadt" />
          </Form.Item>
          <Form.Item label="Stärke-Position" name="staerke_position">
            <Select allowClear placeholder="optional" options={POSITION_OPTIONEN} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
