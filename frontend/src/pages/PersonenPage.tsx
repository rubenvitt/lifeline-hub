import { Alert, App, Breadcrumb, Button, Form, Input, InputNumber, Modal, Select, Space, Spin, Table, Tabs, Tag, Typography, type TableColumnsType } from 'antd';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { personDetailPfad } from '../routing/deeplinks';
import { ladeEinsatz } from '../api/einsaetze';
import { legePersonAn, listePersonen, registrierAnzeige, schlageAbgleichVor, setzePersonStatus, type PersonEingabe } from '../api/einsatzPerson';
import { ApiError } from '../api/client';
import { einsatzKeys } from '../api/queryKeys';
import type { Person, Sichtungskategorie } from '../api/types';
import { SK_META, STATUS_META } from '../personen/personMeta';

/** Triage-Reihenfolge der Patienten-Abschnitte (SK I zuerst, tot zuletzt).
 *  Single Source of Truth dafür, welche Sichtungen einen „Patienten" ausmachen. */
const PATIENT_SK: Sichtungskategorie[] = ['sk1', 'sk2', 'sk3', 'sk4', 'tot'];

/** Patient = gesichtet mit behandlungsrelevanter Kategorie (SK I–IV oder tot);
 *  unverletzt und ungesichtet zählen nicht (LFH-10, rein medizinische Achse). */
function istPatient(p: Person): boolean {
  return p.aktuelle_sichtung != null && PATIENT_SK.includes(p.aktuelle_sichtung);
}

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

/** Sicht-Tabs: 'alle' = kein Filter; 'patienten' = SK-Achse; sonst Status-Filter. */
type Sicht = 'erfasst' | 'vermisst' | 'betroffen' | 'patienten' | 'verstorben' | 'alle';
const SICHTEN: { key: Sicht; label: string }[] = [
  { key: 'erfasst', label: 'Neu' },
  { key: 'vermisst', label: 'Vermisst' },
  { key: 'betroffen', label: 'Betroffen' },
  { key: 'patienten', label: 'Patienten' },
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
  const navigate = useNavigate();
  const [sicht, setSicht] = useState<Sicht>('erfasst');

  // Live-Updates über den konsolidierten useEinsatzLiveStream im EinsatzLayout (LFH-207).

  const einsatzQuery = useQuery({ queryKey: einsatzKeys.einsatz(einsatzId), queryFn: () => ladeEinsatz(einsatzId) });
  const personenQuery = useQuery({
    queryKey: einsatzKeys.personen(einsatzId),
    queryFn: () => listePersonen(einsatzId),
  });

  const qc = useQueryClient();
  const { message } = App.useApp();
  const [modus, setModus] = useState<null | 'schnell' | 'vermisst' | 'betroffen'>(null);
  const [form] = Form.useForm<PersonEingabe>();

  function invalidate() {
    qc.invalidateQueries({ queryKey: einsatzKeys.personen(einsatzId) });
    qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
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

  // Deep-Link: ?person=<id> leitet auf die Detailseite um (rückwärtskompatibel
  // mit dem alten Drawer-Verhalten, z. B. „Vollständig öffnen" aus dem UHS-Drawer).
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const pid = searchParams.get('person');
    if (pid) navigate(personDetailPfad(einsatzId, Number(pid)), { replace: true });
  }, [searchParams, einsatzId, navigate]);

  // Schnellaktion: ?neu=1 öffnet die Schnellerfassung (Command-Palette, LFH-11).
  // Warten bis der Einsatz geladen ist; Param immer löschen, aber Modal nur bei Schreibrecht öffnen.
  useEffect(() => {
    if (searchParams.get('neu') !== '1') return;
    if (einsatzQuery.isLoading) return;
    const e = einsatzQuery.data;
    const darfSchr =
      e?.status === 'aktiv' &&
      (e?.meine_rolle === 'einsatzleitung' || e?.meine_rolle === 'fuehrungspersonal');
    if (darfSchr) setModus('schnell');
    searchParams.delete('neu');
    setSearchParams(searchParams, { replace: true });
  }, [searchParams, setSearchParams, einsatzQuery.isLoading, einsatzQuery.data]);

  const abgleichVorschlagMutation = useMutation({
    mutationFn: (v: { vermisstId: number; gefundenId: number }) =>
      schlageAbgleichVor(einsatzId, v.vermisstId, v.gefundenId),
    onSuccess: () => { invalidate(); message.success('Verdachts-Abgleich angelegt'); },
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

  const alle = personenQuery.data ?? [];
  const personen = (sicht === 'alle' || sicht === 'patienten')
    ? alle
    : alle.filter((p) => p.status === sicht);

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

  const gefundene = alle.filter((p) => ['betroffen', 'verstorben'].includes(p.status) && !p.storniert_at);

  const aktionsSpalte: TableColumnsType<Person> = darfSchreiben && sicht === 'vermisst' ? [{
    title: 'Abgleich vorschlagen', key: 'abgleich', width: 220,
    render: (_: unknown, v: Person) => (
      <Select<number> placeholder="gefundene Person …" size="small" style={{ width: 200 }}
        onClick={(e) => e.stopPropagation()}
        onChange={(gid) => abgleichVorschlagMutation.mutate({ vermisstId: v.id, gefundenId: gid })}
        options={gefundene.map((g) => ({ value: g.id, label: `${registrierAnzeige(g.registrier_nr)} ${g.name ?? 'unbekannt'}` }))}
        disabled={gefundene.length === 0}
      />
    ),
  }] : [];

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
        <Alert style={{ marginBottom: 12 }} type="info" showIcon title="Einsatz ist abgeschlossen — nur Ansicht." />
      )}

      {(() => {
        const z = lagebildZaehlung(alle);
        const patientenAnzahl = PATIENT_SK.reduce((summe, k) => summe + z.sk[k], 0);
        const skTags = (Object.keys(z.sk) as Sichtungskategorie[])
          .filter((k) => z.sk[k] > 0)
          .map((k) => (
            <Tag key={k} color={SK_META[k].color}>{SK_META[k].label}: {z.sk[k]}</Tag>
          ));
        return (
          <Space wrap style={{ marginBottom: 12 }}>
            <Typography.Text type="secondary">Lagebild:</Typography.Text>
            <Tag color="geekblue">Patienten: {patientenAnzahl}</Tag>
            {skTags.length > 0 ? skTags : <Typography.Text type="secondary">noch keine Sichtungen</Typography.Text>}
            <Tag>ungesichtet: {z.ungesichtet}</Tag>
          </Space>
        );
      })()}

      {sicht === 'patienten' ? (
        <Spin spinning={personenQuery.isLoading}>
        <Space orientation="vertical" size="large" style={{ width: '100%' }}>
          {PATIENT_SK.map((sk) => {
            const gruppe = alle.filter((p) => p.aktuelle_sichtung === sk);
            if (gruppe.length === 0) return null;
            return (
              <div key={sk}>
                <Typography.Title level={5} style={{ marginTop: 0 }}>
                  <Tag color={SK_META[sk].color}>{SK_META[sk].label}</Tag>{' '}
                  <Typography.Text type="secondary">
                    {gruppe.length} {gruppe.length === 1 ? 'Patient' : 'Patienten'}
                  </Typography.Text>
                </Typography.Title>
                <Table
                  rowKey="id"
                  dataSource={gruppe}
                  columns={spalten}
                  pagination={false}
                  onRow={(p) => ({ onClick: () => navigate(personDetailPfad(einsatzId, p.id)), style: { cursor: 'pointer' } })}
                />
              </div>
            );
          })}
          {!personenQuery.isLoading && !alle.some(istPatient) && (
            <Alert type="info" showIcon title="Keine Patienten in diesem Einsatz." />
          )}
        </Space>
        </Spin>
      ) : (
        <Table
          rowKey="id"
          loading={personenQuery.isLoading}
          dataSource={personen}
          columns={[...spalten, ...aktionsSpalte]}
          pagination={false}
          locale={{ emptyText: 'Keine Personen in dieser Sicht' }}
          onRow={(p) => ({ onClick: () => navigate(personDetailPfad(einsatzId, p.id)), style: { cursor: 'pointer' } })}
        />
      )}

      <Modal
        open={modus !== null}
        title={modus === 'vermisst' ? 'Vermisst melden' : modus === 'betroffen' ? 'Betroffene/n erfassen' : 'Schnellerfassung'}
        okText="Erfassen"
        confirmLoading={anlegenMutation.isPending}
        onOk={() => form.submit()}
        onCancel={() => { setModus(null); form.resetFields(); }}
        destroyOnHidden
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
