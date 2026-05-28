import { Alert, App, Breadcrumb, Button, Descriptions, Drawer, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Spin, Table, Tabs, Tag, Typography, type TableColumnsType } from 'antd';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ladeEinsatz } from '../api/einsaetze';
import { aktualisierePerson, ladePerson, ladePersonAudit, legePersonAn, listePersonen, registrierAnzeige, setzePersonStatus, stornierePerson, type PersonEingabe } from '../api/einsatzPerson';
import { ApiError } from '../api/client';
import { usePersonenStream } from '../etb/usePersonenStream';
import type { Person, PersonStatus, PersonZugriff, Sichtungskategorie } from '../api/types';

const SK_META: Record<Sichtungskategorie, { label: string; color: string }> = {
  sk1: { label: 'SK I', color: 'red' },
  sk2: { label: 'SK II', color: 'gold' },
  sk3: { label: 'SK III', color: 'green' },
  sk4: { label: 'SK IV', color: 'blue' },
  tot: { label: 'tot', color: 'black' },
  unverletzt: { label: 'unverletzt', color: 'default' },
};

/** Zählt je SK-Kategorie + Gruppen „ungesichtet" und „unverletzt" (Spec-Drei-Teilung). */
function lagebildZaehlung(alle: Person[]): { sk: Record<Sichtungskategorie, number>; ungesichtet: number } {
  const sk: Record<Sichtungskategorie, number> = { sk1: 0, sk2: 0, sk3: 0, sk4: 0, tot: 0, unverletzt: 0 };
  let ungesichtet = 0;
  for (const p of alle) {
    if (p.aktuelle_sichtung) sk[p.aktuelle_sichtung]++;
    else ungesichtet++;
  }
  return { sk, ungesichtet };
}

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

/** Erlaubte Folge-Status (Spiegel von darf_uebergehen im Backend). */
function naechsteStatus(aktuell: PersonStatus): PersonStatus[] {
  switch (aktuell) {
    case 'erfasst': return ['vermisst', 'betroffen', 'verstorben', 'abgemeldet'];
    case 'vermisst': return ['betroffen', 'verstorben', 'abgemeldet'];
    case 'betroffen': return ['vermisst', 'verstorben', 'abgemeldet'];
    case 'verstorben':
    case 'abgemeldet': return ['erfasst', 'vermisst', 'betroffen'];
  }
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

  const [offenePersonId, setOffenePersonId] = useState<number | null>(null);
  const [bearbeiten, setBearbeiten] = useState(false);
  const [editForm] = Form.useForm<PersonEingabe>();

  const detailQuery = useQuery({
    queryKey: ['einsatz-person', einsatzId, offenePersonId],
    queryFn: () => ladePerson(einsatzId, offenePersonId!),
    enabled: offenePersonId != null,
  });
  const auditQuery = useQuery({
    queryKey: ['einsatz-person-audit', einsatzId, offenePersonId],
    queryFn: () => ladePersonAudit(einsatzId, offenePersonId!),
    enabled: offenePersonId != null && einsatzQuery.data?.meine_rolle === 'einsatzleitung',
  });

  function invalidateDetail() {
    invalidate();
    qc.invalidateQueries({ queryKey: ['einsatz-person', einsatzId, offenePersonId] });
  }
  const statusMutation = useMutation({
    mutationFn: (v: { personId: number; status: PersonStatus }) => setzePersonStatus(einsatzId, v.personId, v.status),
    onSuccess: invalidateDetail, onError: fehler,
  });
  const editMutation = useMutation({
    mutationFn: (daten: PersonEingabe) => aktualisierePerson(einsatzId, offenePersonId!, daten),
    onSuccess: () => { invalidateDetail(); setBearbeiten(false); }, onError: fehler,
  });
  const stornoMutation = useMutation({
    mutationFn: (personId: number) => stornierePerson(einsatzId, personId),
    onSuccess: () => { invalidate(); setOffenePersonId(null); }, onError: fehler,
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
      title: 'SK', key: 'sk', width: 90,
      render: (_, p) =>
        p.aktuelle_sichtung
          ? <Tag color={SK_META[p.aktuelle_sichtung].color}>{SK_META[p.aktuelle_sichtung].label}</Tag>
          : <Typography.Text type="secondary">—</Typography.Text>,
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

      {(() => {
        const z = lagebildZaehlung(alle);
        const skTags = (Object.keys(z.sk) as Sichtungskategorie[])
          .filter((k) => z.sk[k] > 0)
          .map((k) => (
            <Tag key={k} color={SK_META[k].color}>{SK_META[k].label}: {z.sk[k]}</Tag>
          ));
        return (
          <Space wrap style={{ marginBottom: 12 }}>
            <Typography.Text type="secondary">Lagebild:</Typography.Text>
            {skTags.length > 0 ? skTags : <Typography.Text type="secondary">noch keine Sichtungen</Typography.Text>}
            <Tag>ungesichtet: {z.ungesichtet}</Tag>
          </Space>
        );
      })()}

      <Table
        rowKey="id"
        loading={personenQuery.isLoading}
        dataSource={personen}
        columns={spalten}
        pagination={false}
        locale={{ emptyText: 'Keine Personen in dieser Sicht' }}
        onRow={(p) => ({ onClick: () => { setOffenePersonId(p.id); setBearbeiten(false); }, style: { cursor: 'pointer' } })}
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

      <Drawer
        open={offenePersonId != null}
        width={520}
        title={detailQuery.data ? `Person ${registrierAnzeige(detailQuery.data.registrier_nr)}` : 'Person'}
        onClose={() => { setOffenePersonId(null); setBearbeiten(false); }}
      >
        {detailQuery.isLoading && <Spin />}
        {detailQuery.data && (() => {
          const p = detailQuery.data;
          return (
            <Space direction="vertical" style={{ width: '100%' }} size="large">
              <Space>
                <Tag color={STATUS_META[p.status].color}>{STATUS_META[p.status].label}</Tag>
                {p.storniert_at && <Tag color="default">storniert</Tag>}
              </Space>

              {darfSchreiben && !p.storniert_at && (
                <Space wrap>
                  {naechsteStatus(p.status).map((s) => (
                    <Button key={s} size="small"
                      onClick={() => statusMutation.mutate({ personId: p.id, status: s })}>
                      → {STATUS_META[s].label}
                    </Button>
                  ))}
                </Space>
              )}

              {bearbeiten ? (
                <Form form={editForm} layout="vertical" initialValues={p}
                  onFinish={(daten) => editMutation.mutate(daten)}>
                  <Form.Item label="Name" name="name"><Input /></Form.Item>
                  <Form.Item label="Vorname" name="vorname"><Input /></Form.Item>
                  <Form.Item label="Geschlecht" name="geschlecht">
                    <Select allowClear options={[
                      { value: 'maennlich', label: 'männlich' }, { value: 'weiblich', label: 'weiblich' },
                      { value: 'divers', label: 'divers' }, { value: 'unbekannt', label: 'unbekannt' },
                    ]} />
                  </Form.Item>
                  <Form.Item label="Geburtsdatum (YYYY-MM-DD)" name="geburtsdatum"><Input /></Form.Item>
                  <Form.Item label="Geschätztes Alter" name="alter_geschaetzt"><InputNumber min={0} max={120} /></Form.Item>
                  <Form.Item label="Herkunft / Adresse" name="herkunft_adresse"><Input /></Form.Item>
                  <Form.Item label="Antreffort" name="antreff_ort"><Input /></Form.Item>
                  <Form.Item label="Melder / Kontakt" name="melder_kontakt"><Input /></Form.Item>
                  <Form.Item label="Notiz" name="notiz"><Input.TextArea rows={2} /></Form.Item>
                  <Space>
                    <Button type="primary" htmlType="submit" loading={editMutation.isPending}>Speichern</Button>
                    <Button onClick={() => setBearbeiten(false)}>Abbrechen</Button>
                  </Space>
                </Form>
              ) : (
                <Descriptions column={1} size="small" bordered>
                  <Descriptions.Item label="Name">{p.name ?? '—'}</Descriptions.Item>
                  <Descriptions.Item label="Vorname">{p.vorname ?? '—'}</Descriptions.Item>
                  <Descriptions.Item label="Geschlecht">{p.geschlecht ?? '—'}</Descriptions.Item>
                  <Descriptions.Item label="Geburtsdatum">{p.geburtsdatum ?? '—'}</Descriptions.Item>
                  <Descriptions.Item label="Alter (geschätzt)">{p.alter_geschaetzt ?? '—'}</Descriptions.Item>
                  <Descriptions.Item label="Herkunft / Adresse">{p.herkunft_adresse ?? '—'}</Descriptions.Item>
                  <Descriptions.Item label="Antreffort">{p.antreff_ort ?? '—'}</Descriptions.Item>
                  <Descriptions.Item label="Melder / Kontakt">{p.melder_kontakt ?? '—'}</Descriptions.Item>
                  <Descriptions.Item label="Notiz">{p.notiz ?? '—'}</Descriptions.Item>
                </Descriptions>
              )}

              {darfSchreiben && !p.storniert_at && !bearbeiten && (
                <Space>
                  <Button onClick={() => { setBearbeiten(true); editForm.setFieldsValue(p); }}>Bearbeiten</Button>
                  <Popconfirm title="Person stornieren (Soft-Delete)?" onConfirm={() => stornoMutation.mutate(p.id)}>
                    <Button danger>Stornieren</Button>
                  </Popconfirm>
                </Space>
              )}

              {einsatz.meine_rolle === 'einsatzleitung' && (
                <div>
                  <Typography.Text type="secondary" style={{ fontSize: 12, textTransform: 'uppercase' }}>
                    Zugriffs-Audit
                  </Typography.Text>
                  <Table<PersonZugriff>
                    rowKey="id" size="small" pagination={false}
                    loading={auditQuery.isLoading}
                    dataSource={auditQuery.data ?? []}
                    columns={[
                      { title: 'Wann', dataIndex: 'zugriff_at', key: 'zugriff_at' },
                      { title: 'Wer', dataIndex: 'benutzer_name', key: 'benutzer_name' },
                      { title: 'Art', dataIndex: 'art', key: 'art' },
                    ]}
                    locale={{ emptyText: 'Noch keine Zugriffe' }}
                  />
                </div>
              )}
            </Space>
          );
        })()}
      </Drawer>
    </div>
  );
}
