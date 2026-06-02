import { Alert, App, Breadcrumb, Button, Descriptions, Drawer, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Spin, Table, Tabs, Tag, Typography, type TableColumnsType } from 'antd';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ladeEinsatz } from '../api/einsaetze';
import { aktualisierePerson, entscheideAbgleich, erfasseSichtung, erfasseVerbleib, ladePerson, ladePersonAudit, legeNotizAn, legePersonAn, listePersonen, registrierAnzeige, schlageAbgleichVor, setzePersonStatus, stornierePerson, type PersonEingabe } from '../api/einsatzPerson';
import { ApiError } from '../api/client';
import { usePersonenStream } from '../etb/usePersonenStream';
import { useTiereStream } from '../etb/useTiereStream';
import { listeTiere, tierRegistrierAnzeige } from '../api/einsatzTier';
import { useSchaedenStream } from '../etb/useSchaedenStream';
import { listeSchaeden, schadenRegistrierAnzeige } from '../api/einsatzSchaden';
import type { Person, PersonDetail, PersonStatus, PersonZugriff, Sichtungskategorie, Verbleib, VerbleibArt, Tier, Spezies, Schaden } from '../api/types';

const SK_META: Record<Sichtungskategorie, { label: string; color: string }> = {
  sk1: { label: 'SK I', color: 'red' },
  sk2: { label: 'SK II', color: 'gold' },
  sk3: { label: 'SK III', color: 'green' },
  sk4: { label: 'SK IV', color: 'blue' },
  tot: { label: 'tot', color: 'black' },
  unverletzt: { label: 'unverletzt', color: 'default' },
};

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

const STATUS_META: Record<PersonStatus, { label: string; color: string }> = {
  erfasst: { label: 'erfasst', color: 'default' },
  vermisst: { label: 'vermisst', color: 'orange' },
  betroffen: { label: 'betroffen', color: 'blue' },
  verstorben: { label: 'verstorben', color: 'red' },
  abgemeldet: { label: 'abgemeldet', color: 'green' },
};

const TIER_SPEZIES_LABEL: Record<Spezies, string> = {
  hund: 'Hund', katze: 'Katze', grosstier: 'Großtier', nutzgefluegel: 'Nutzgeflügel',
  kleintier: 'Kleintier', wildtier: 'Wildtier', sonstige: 'Sonstige',
};

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

function kurzVerbleib(v: Verbleib): string {
  const ziel = v.ziel ? ` → ${v.ziel}` : '';
  const tm = v.transportmittel ? ` (${v.transportmittel})` : '';
  switch (v.art) {
    case 'transport': return `Transport${ziel}${tm}`;
    case 'entlassung': return 'entlassen';
    case 'vor_ort': return 'verbleibt vor Ort';
    case 'verstorben': return 'Verbleib des Leichnams';
  }
}

export default function PersonenPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const navigate = useNavigate();
  const [sicht, setSicht] = useState<Sicht>('erfasst');

  usePersonenStream(einsatzId);
  useTiereStream(einsatzId); // hält den „Zugeordnete Tiere"-Block live
  useSchaedenStream(einsatzId); // hält den „Als Geschädigte bei Schäden"-Block live

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
  const tiereDerPersonQuery = useQuery({
    queryKey: ['einsatz-tiere', einsatzId, 'halter', offenePersonId],
    queryFn: () => listeTiere(einsatzId, { halterPersonId: offenePersonId! }),
    enabled: offenePersonId != null,
  });
  const schaedenDerPersonQuery = useQuery({
    queryKey: ['einsatz-schaeden', einsatzId, 'geschaedigt', offenePersonId],
    queryFn: () => listeSchaeden(einsatzId, { geschaedigtPersonId: offenePersonId!, inklStorniert: false }),
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

  // E-2: Sichtung
  const [reSichtenOffen, setReSichtenOffen] = useState(false);
  const [sichtungForm] = Form.useForm<{ kategorie: Sichtungskategorie; notiz?: string }>();
  const sichtungMutation = useMutation({
    mutationFn: (v: { kategorie: Sichtungskategorie; notiz?: string }) =>
      erfasseSichtung(einsatzId, offenePersonId!, v.kategorie, v.notiz ?? null),
    onSuccess: () => { invalidateDetail(); setReSichtenOffen(false); sichtungForm.resetFields(); },
    onError: fehler,
  });

  // E-2: Verlaufsnotiz
  const [notizForm] = Form.useForm<{ text: string }>();
  const notizMutation = useMutation({
    mutationFn: (v: { text: string }) => legeNotizAn(einsatzId, offenePersonId!, v.text),
    onSuccess: () => { invalidateDetail(); notizForm.resetFields(); },
    onError: fehler,
  });

  // E-2: Verbleib
  const [verbleibOffen, setVerbleibOffen] = useState(false);
  const [verbleibForm] = Form.useForm<{ art: VerbleibArt; ziel?: string; transportmittel?: string; notiz?: string }>();
  const verbleibMutation = useMutation({
    mutationFn: (v: { art: VerbleibArt; ziel?: string; transportmittel?: string; notiz?: string }) =>
      erfasseVerbleib(einsatzId, offenePersonId!, {
        art: v.art, ziel: v.ziel ?? null, transportmittel: v.transportmittel ?? null,
        status: v.art === 'transport' ? 'abtransportiert' : null, notiz: v.notiz ?? null,
      }),
    onSuccess: () => { invalidateDetail(); setVerbleibOffen(false); verbleibForm.resetFields(); },
    onError: fehler,
  });

  const abgleichVorschlagMutation = useMutation({
    mutationFn: (v: { vermisstId: number; gefundenId: number }) =>
      schlageAbgleichVor(einsatzId, v.vermisstId, v.gefundenId),
    onSuccess: () => { invalidateDetail(); message.success('Verdachts-Abgleich angelegt'); },
    onError: fehler,
  });
  const abgleichEntscheidenMutation = useMutation({
    mutationFn: (v: { vermisstId: number; abgleichId: number; entscheidung: 'bestaetigt' | 'verworfen' }) =>
      entscheideAbgleich(einsatzId, v.vermisstId, v.abgleichId, v.entscheidung),
    onSuccess: invalidateDetail, onError: fehler,
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

  function drawerInhalt(p: PersonDetail) {
    const eintraege: Array<{ key: string; at: string; node: React.ReactNode }> = [
      ...(p.sichtungen ?? []).map((s) => ({
        key: `s-${s.id}`, at: s.gesichtet_at,
        node: <span><Tag color={SK_META[s.kategorie].color}>{SK_META[s.kategorie].label}</Tag>
          {s.notiz && <Typography.Text type="secondary"> — {s.notiz}</Typography.Text>}</span>,
      })),
      ...(p.notizen ?? []).map((n) => ({
        key: `n-${n.id}`, at: n.erfasst_at,
        node: <span><Tag>Notiz</Tag> {n.text}</span>,
      })),
      ...(p.verbleib ?? []).map((v) => ({
        key: `v-${v.id}`, at: v.zeitpunkt_at,
        node: <span><Tag color="purple">Verbleib</Tag> {kurzVerbleib(v)}</span>,
      })),
    ].sort((a, b) => b.at.localeCompare(a.at));

    return (
      <Tabs
        items={[
          {
            key: 'stamm',
            label: 'Stammdaten',
            children: (
              <Space direction="vertical" style={{ width: '100%' }} size="large">
                <Space>
                  <Tag color={STATUS_META[p.status].color}>{STATUS_META[p.status].label}</Tag>
                  {istPatient(p) && <Tag color="geekblue">Patient</Tag>}
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

                <div>
                  <Typography.Text type="secondary" style={{ fontSize: 12, textTransform: 'uppercase' }}>
                    Zugeordnete Tiere
                  </Typography.Text>
                  {(tiereDerPersonQuery.data?.length ?? 0) === 0 ? (
                    <div><Typography.Text type="secondary">keine</Typography.Text></div>
                  ) : (
                    <Space wrap style={{ marginTop: 4 }}>
                      {(tiereDerPersonQuery.data ?? []).map((t: Tier) => (
                        <Tag
                          key={t.id}
                          color="cyan"
                          style={{ cursor: 'pointer' }}
                          onClick={() => navigate(`/einsaetze/${einsatzId}/tiere`)}
                        >
                          {tierRegistrierAnzeige(t.registrier_nr)} {TIER_SPEZIES_LABEL[t.spezies] ?? t.spezies}
                          {t.rufname ? ` „${t.rufname}"` : ''}
                        </Tag>
                      ))}
                    </Space>
                  )}
                </div>

                <div>
                  <Typography.Text type="secondary" style={{ fontSize: 12, textTransform: 'uppercase' }}>
                    Als Geschädigte bei Schäden
                  </Typography.Text>
                  {(schaedenDerPersonQuery.data?.length ?? 0) === 0 ? (
                    <div><Typography.Text type="secondary">keine</Typography.Text></div>
                  ) : (
                    <Space wrap style={{ marginTop: 4 }}>
                      {(schaedenDerPersonQuery.data ?? []).map((sch: Schaden) => (
                        <Tag
                          key={sch.id}
                          color="orange"
                          style={{ cursor: 'pointer' }}
                          onClick={() => navigate(`/einsaetze/${einsatzId}/schaeden`)}
                        >
                          {schadenRegistrierAnzeige(sch.registrier_nr)} {sch.typ} ({sch.ausmass}) — {sch.status}
                        </Tag>
                      ))}
                    </Space>
                  )}
                </div>

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
            ),
          },
          {
            key: 'med',
            label: 'Medizinischer Verlauf',
            children: (
              <Space direction="vertical" style={{ width: '100%' }} size="large">
                <Space wrap>
                  {istPatient(p) && <Tag color="geekblue">Patient</Tag>}
                  {p.aktuelle_sichtung
                    ? <Tag color={SK_META[p.aktuelle_sichtung].color}>SK: {SK_META[p.aktuelle_sichtung].label}</Tag>
                    : <Tag>ungesichtet</Tag>}
                  {p.aktueller_verbleib && <Tag color="purple">{p.aktueller_verbleib}</Tag>}
                </Space>
                {darfSchreiben && !p.storniert_at && (
                  <Space wrap>
                    <Button onClick={() => setReSichtenOffen(true)}>Re-Sichten</Button>
                    <Button onClick={() => setVerbleibOffen(true)}>Verbleib erfassen</Button>
                  </Space>
                )}
                {darfSchreiben && p.aktuelle_sichtung === 'tot' && p.status !== 'verstorben' && (
                  <Alert
                    type="warning" showIcon
                    message="Sichtung = tot. Admin-Status wurde NICHT automatisch geändert."
                    action={
                      <Button size="small" onClick={() => statusMutation.mutate({ personId: p.id, status: 'verstorben' })}>
                        Status → verstorben
                      </Button>
                    }
                  />
                )}
                {darfSchreiben && !p.storniert_at && (
                  <Form form={notizForm} layout="vertical" onFinish={notizMutation.mutate}>
                    <Form.Item label="Befund/Verlaufsnotiz (append-only, kein ETB)" name="text"
                      rules={[{ required: true, message: 'Bitte Text eingeben' }]}>
                      <Input.TextArea rows={2} />
                    </Form.Item>
                    <Button type="primary" htmlType="submit" loading={notizMutation.isPending}>Notiz anlegen</Button>
                  </Form>
                )}
                <div>
                  <Typography.Text type="secondary" style={{ fontSize: 12, textTransform: 'uppercase' }}>
                    Chronologischer Verlauf (neueste zuerst)
                  </Typography.Text>
                  {eintraege.length === 0
                    ? <Typography.Text type="secondary"> noch leer</Typography.Text>
                    : <ul style={{ listStyle: 'none', paddingLeft: 0 }}>
                        {eintraege.map((e) => (
                          <li key={e.key} style={{ padding: '4px 0', borderBottom: '1px solid #f0f0f0' }}>
                            <Typography.Text type="secondary" style={{ fontSize: 12, marginRight: 8 }}>{e.at}</Typography.Text>
                            {e.node}
                          </li>
                        ))}
                      </ul>}
                </div>
                {(p.abgleiche?.length ?? 0) > 0 && (
                  <div>
                    <Typography.Text type="secondary" style={{ fontSize: 12, textTransform: 'uppercase' }}>
                      Vermisstenabgleich
                    </Typography.Text>
                    <ul style={{ listStyle: 'none', paddingLeft: 0 }}>
                      {p.abgleiche.map((a) => (
                        <li key={a.id} style={{ padding: '4px 0' }}>
                          <Tag color={a.status === 'bestaetigt' ? 'green' : a.status === 'verworfen' ? 'default' : 'gold'}>{a.status}</Tag>
                          <Typography.Text>
                            R-{String(a.vermisst_person_id === p.id ? a.gefunden_person_id : a.vermisst_person_id).padStart(3, '0')}
                          </Typography.Text>
                          {a.status === 'verdacht' && a.vermisst_person_id === p.id && (
                            <Space style={{ marginLeft: 12 }}>
                              <Button size="small" type="primary"
                                disabled={einsatz.meine_rolle !== 'einsatzleitung'}
                                onClick={() => abgleichEntscheidenMutation.mutate({
                                  vermisstId: p.id, abgleichId: a.id, entscheidung: 'bestaetigt' })}>
                                Bestätigen
                              </Button>
                              <Button size="small" danger
                                disabled={einsatz.meine_rolle !== 'einsatzleitung'}
                                onClick={() => abgleichEntscheidenMutation.mutate({
                                  vermisstId: p.id, abgleichId: a.id, entscheidung: 'verworfen' })}>
                                Verwerfen
                              </Button>
                            </Space>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </Space>
            ),
          },
        ]}
      />
    );
  }

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
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
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
                  onRow={(p) => ({ onClick: () => { setOffenePersonId(p.id); setBearbeiten(false); }, style: { cursor: 'pointer' } })}
                />
              </div>
            );
          })}
          {!personenQuery.isLoading && !alle.some(istPatient) && (
            <Alert type="info" showIcon message="Keine Patienten in diesem Einsatz." />
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
          onRow={(p) => ({ onClick: () => { setOffenePersonId(p.id); setBearbeiten(false); }, style: { cursor: 'pointer' } })}
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

      <Drawer
        open={offenePersonId != null}
        width={520}
        title={detailQuery.data ? `Person ${registrierAnzeige(detailQuery.data.registrier_nr)}` : 'Person'}
        onClose={() => { setOffenePersonId(null); setBearbeiten(false); }}
      >
        {detailQuery.isLoading && <Spin />}
        {detailQuery.data && drawerInhalt(detailQuery.data)}
      </Drawer>

      <Modal
        open={reSichtenOffen}
        title="Sichtung erfassen"
        okText="Übernehmen"
        confirmLoading={sichtungMutation.isPending}
        onOk={() => sichtungForm.submit()}
        onCancel={() => { setReSichtenOffen(false); sichtungForm.resetFields(); }}
        destroyOnHidden
      >
        <Form form={sichtungForm} layout="vertical" onFinish={sichtungMutation.mutate}>
          <Form.Item label="Kategorie" name="kategorie" rules={[{ required: true }]}>
            <Select options={(Object.keys(SK_META) as Sichtungskategorie[]).map((k) => ({ value: k, label: SK_META[k].label }))} />
          </Form.Item>
          <Form.Item label="Kurzbegründung (optional)" name="notiz">
            <Input />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={verbleibOffen}
        title="Verbleib erfassen"
        okText="Erfassen"
        confirmLoading={verbleibMutation.isPending}
        onOk={() => verbleibForm.submit()}
        onCancel={() => { setVerbleibOffen(false); verbleibForm.resetFields(); }}
        destroyOnHidden
      >
        <Form form={verbleibForm} layout="vertical" onFinish={verbleibMutation.mutate}>
          <Form.Item label="Art" name="art" rules={[{ required: true }]}>
            <Select options={[
              { value: 'transport', label: 'Transport' },
              { value: 'entlassung', label: 'Entlassung vor Ort' },
              { value: 'vor_ort', label: 'verbleibt vor Ort' },
              { value: 'verstorben', label: 'Verbleib des Leichnams' },
            ]} />
          </Form.Item>
          <Form.Item label="Ziel (z. B. Krankenhaus, Freitext)" name="ziel"><Input /></Form.Item>
          <Form.Item label="Transportmittel (RTW/KTW …)" name="transportmittel"><Input /></Form.Item>
          <Form.Item label="Notiz" name="notiz"><Input.TextArea rows={2} /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
