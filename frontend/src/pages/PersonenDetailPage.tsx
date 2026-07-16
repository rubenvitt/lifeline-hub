import { Alert, App, Breadcrumb, Button, Col, Descriptions, Form, Input, InputNumber, Modal, Popconfirm, Row, Space, Spin, Table, Tag, Typography, type TableColumnsType } from 'antd';
import { Select } from '../components/Select';
import { useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ladeEinsatz } from '../api/einsaetze';
import { aktualisierePerson, entscheideAbgleich, erfasseSichtung, erfasseVerbleib, ladePerson, ladePersonAudit, legeNotizAn, registrierAnzeige, setzePersonStatus, stornierePerson, type PersonEingabe } from '../api/einsatzPerson';
import { listeTiere, tierRegistrierAnzeige } from '../api/einsatzTier';
import { listeSchaeden, schadenRegistrierAnzeige } from '../api/einsatzSchaden';
import { ApiError } from '../api/client';
import { einsatzKeys } from '../api/queryKeys';
import { SK_META, STATUS_META } from '../personen/personMeta';
import type { PersonDetail, PersonStatus, PersonZugriff, Schaden, Sichtungskategorie, Spezies, Tier, Verbleib, VerbleibArt } from '../api/types';
import { parseRouteId, personenPfad, schadenDetailPfad, tiereDetailPfad } from '../routing/deeplinks';

const TIER_SPEZIES_LABEL: Record<Spezies, string> = {
  hund: 'Hund', katze: 'Katze', grosstier: 'Großtier', nutzgefluegel: 'Nutzgeflügel',
  kleintier: 'Kleintier', wildtier: 'Wildtier', sonstige: 'Sonstige',
};

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

/** Triage-Reihenfolge der Patienten-Abschnitte (SK I zuerst, tot zuletzt). */
const PATIENT_SK: Sichtungskategorie[] = ['sk1', 'sk2', 'sk3', 'sk4', 'tot'];

/** Patient = gesichtet mit behandlungsrelevanter Kategorie (SK I–IV oder tot). */
function istPatient(p: PersonDetail): boolean {
  return p.aktuelle_sichtung != null && PATIENT_SK.includes(p.aktuelle_sichtung);
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

export default function PersonenDetailPage() {
  const { id, personId: personIdParam } = useParams();
  const einsatzId = Number(id);
  const personId = Number(personIdParam);
  const idGueltig = parseRouteId(personIdParam) != null;
  const navigate = useNavigate();

  const qc = useQueryClient();
  const { message } = App.useApp();
  const [bearbeiten, setBearbeiten] = useState(false);
  const [editForm] = Form.useForm<PersonEingabe>();

  const fehler = (e: unknown) => message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen');

  function invalidate() {
    qc.invalidateQueries({ queryKey: einsatzKeys.personen(einsatzId) });
    qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
  }
  function invalidateDetail() {
    invalidate();
    qc.invalidateQueries({ queryKey: einsatzKeys.person(einsatzId, personId) });
  }

  const einsatzQuery = useQuery({ queryKey: einsatzKeys.einsatz(einsatzId), queryFn: () => ladeEinsatz(einsatzId) });
  const detailQuery = useQuery({
    queryKey: einsatzKeys.person(einsatzId, personId),
    queryFn: () => ladePerson(einsatzId, personId),
    enabled: idGueltig,
  });
  const tiereDerPersonQuery = useQuery({
    queryKey: einsatzKeys.tiereHalter(einsatzId, personId),
    queryFn: () => listeTiere(einsatzId, { halterPersonId: personId }),
    enabled: idGueltig,
  });
  const schaedenDerPersonQuery = useQuery({
    queryKey: einsatzKeys.schaedenGeschaedigt(einsatzId, personId),
    queryFn: () => listeSchaeden(einsatzId, { geschaedigtPersonId: personId, inklStorniert: false }),
    enabled: idGueltig,
  });
  const auditQuery = useQuery({
    queryKey: einsatzKeys.personAudit(einsatzId, personId),
    queryFn: () => ladePersonAudit(einsatzId, personId),
    enabled: idGueltig && einsatzQuery.data?.meine_rolle === 'einsatzleitung',
  });

  const statusMutation = useMutation({
    mutationFn: (v: { personId: number; status: PersonStatus }) => setzePersonStatus(einsatzId, v.personId, v.status),
    onSuccess: invalidateDetail, onError: fehler,
  });
  const editMutation = useMutation({
    mutationFn: (daten: PersonEingabe) => aktualisierePerson(einsatzId, personId, daten),
    onSuccess: () => { invalidateDetail(); setBearbeiten(false); }, onError: fehler,
  });
  const stornoMutation = useMutation({
    mutationFn: (pid: number) => stornierePerson(einsatzId, pid),
    onSuccess: () => { invalidate(); navigate(personenPfad(einsatzId)); }, onError: fehler,
  });

  // E-2: Sichtung
  const [reSichtenOffen, setReSichtenOffen] = useState(false);
  const [sichtungForm] = Form.useForm<{ kategorie: Sichtungskategorie; notiz?: string }>();
  const sichtungMutation = useMutation({
    mutationFn: (v: { kategorie: Sichtungskategorie; notiz?: string }) =>
      erfasseSichtung(einsatzId, personId, v.kategorie, v.notiz ?? null),
    onSuccess: () => { invalidateDetail(); setReSichtenOffen(false); sichtungForm.resetFields(); },
    onError: fehler,
  });

  // E-2: Verlaufsnotiz
  const [notizForm] = Form.useForm<{ text: string }>();
  const notizMutation = useMutation({
    mutationFn: (v: { text: string }) => legeNotizAn(einsatzId, personId, v.text),
    onSuccess: () => { invalidateDetail(); notizForm.resetFields(); },
    onError: fehler,
  });

  // E-2: Verbleib
  const [verbleibOffen, setVerbleibOffen] = useState(false);
  const [verbleibForm] = Form.useForm<{ art: VerbleibArt; ziel?: string; transportmittel?: string; notiz?: string }>();
  const verbleibMutation = useMutation({
    mutationFn: (v: { art: VerbleibArt; ziel?: string; transportmittel?: string; notiz?: string }) =>
      erfasseVerbleib(einsatzId, personId, {
        art: v.art, ziel: v.ziel ?? null, transportmittel: v.transportmittel ?? null,
        status: v.art === 'transport' ? 'abtransportiert' : null, notiz: v.notiz ?? null,
      }),
    onSuccess: () => { invalidateDetail(); setVerbleibOffen(false); verbleibForm.resetFields(); },
    onError: fehler,
  });

  const abgleichEntscheidenMutation = useMutation({
    mutationFn: (v: { vermisstId: number; abgleichId: number; entscheidung: 'bestaetigt' | 'verworfen' }) =>
      entscheideAbgleich(einsatzId, v.vermisstId, v.abgleichId, v.entscheidung),
    onSuccess: invalidateDetail, onError: fehler,
  });

  // Die „Zugeordnete Tiere/Schäden"-Blöcke werden über den konsolidierten Einsatz-Live-
  // Stream (useEinsatzLiveStream im EinsatzLayout) live gehalten: `tier`→'einsatz-tiere'
  // (LFH-75), `schaden`→'einsatz-schaeden' (LFH-206). Der Prefix-Match deckt die
  // Drawer-Keys ['einsatz-tiere', …, 'halter', personId] bzw.
  // ['einsatz-schaeden', …, 'geschaedigt', personId] mit ab.

  // Deeplink-Robustheit (LFH-25): strukturell ungültige Personen-ID → zurück zur Liste,
  // statt mit NaN aussichtslos zu laden. Steht nach allen Hooks (Rules-of-Hooks).
  if (!idGueltig) {
    return <Navigate to={personenPfad(einsatzId)} replace />;
  }

  if (einsatzQuery.isLoading || detailQuery.isLoading) {
    return <div style={{ textAlign: 'center', paddingTop: 80 }}><Spin size="large" /></div>;
  }
  if (einsatzQuery.isError || !einsatzQuery.data) {
    return <Alert type="error" title="Einsatz nicht gefunden oder kein Zugriff" showIcon />;
  }
  const einsatz = einsatzQuery.data;
  const zurueck = personenPfad(einsatzId);

  if (detailQuery.isError) {
    return (
      <Alert
        type="error" showIcon
        title="Person konnte nicht geladen werden"
        description={detailQuery.error instanceof ApiError ? detailQuery.error.message : undefined}
        action={<Button size="small" onClick={() => detailQuery.refetch()}>Erneut versuchen</Button>}
      />
    );
  }
  if (!detailQuery.data) {
    return <Alert type="error" title="Person nicht gefunden" showIcon />;
  }
  const p = detailQuery.data;

  const darfSchreiben =
    einsatz.status === 'aktiv' &&
    (einsatz.meine_rolle === 'einsatzleitung' || einsatz.meine_rolle === 'fuehrungspersonal');

  const auditSpalten: TableColumnsType<PersonZugriff> = [
    { title: 'Wann', dataIndex: 'zugriff_at', key: 'zugriff_at' },
    { title: 'Wer', dataIndex: 'benutzer_name', key: 'benutzer_name' },
    { title: 'Art', dataIndex: 'art', key: 'art' },
  ];

  function medSpalte(person: PersonDetail) {
    const eintraege: Array<{ key: string; at: string; node: React.ReactNode }> = [
      ...(person.sichtungen ?? []).map((s) => ({
        key: `s-${s.id}`, at: s.gesichtet_at,
        node: <span><Tag color={SK_META[s.kategorie].color}>{SK_META[s.kategorie].label}</Tag>
          {s.notiz && <Typography.Text type="secondary"> — {s.notiz}</Typography.Text>}</span>,
      })),
      ...(person.notizen ?? []).map((n) => ({
        key: `n-${n.id}`, at: n.erfasst_at,
        node: <span><Tag>Notiz</Tag> {n.text}</span>,
      })),
      ...(person.verbleib ?? []).map((v) => ({
        key: `v-${v.id}`, at: v.zeitpunkt_at,
        node: <span><Tag color="purple">Verbleib</Tag> {kurzVerbleib(v)}</span>,
      })),
    ].sort((a, b) => b.at.localeCompare(a.at));

    return (
      <Space orientation="vertical" style={{ width: '100%' }} size="large">
        <Space wrap>
          {istPatient(person) && <Tag color="geekblue">Patient</Tag>}
          {person.aktuelle_sichtung
            ? <Tag color={SK_META[person.aktuelle_sichtung].color}>SK: {SK_META[person.aktuelle_sichtung].label}</Tag>
            : <Tag>ungesichtet</Tag>}
          {person.aktueller_verbleib && <Tag color="purple">{person.aktueller_verbleib}</Tag>}
        </Space>
        {darfSchreiben && !person.storniert_at && (
          <Space wrap>
            <Button onClick={() => setReSichtenOffen(true)}>Re-Sichten</Button>
            <Button onClick={() => setVerbleibOffen(true)}>Verbleib erfassen</Button>
          </Space>
        )}
        {darfSchreiben && person.aktuelle_sichtung === 'tot' && person.status !== 'verstorben' && (
          <Alert
            type="warning" showIcon
            title="Sichtung = tot. Admin-Status wurde NICHT automatisch geändert."
            action={
              <Button size="small" onClick={() => statusMutation.mutate({ personId: person.id, status: 'verstorben' })}>
                Status → verstorben
              </Button>
            }
          />
        )}
        {darfSchreiben && !person.storniert_at && (
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
        {(person.abgleiche?.length ?? 0) > 0 && (
          <div>
            <Typography.Text type="secondary" style={{ fontSize: 12, textTransform: 'uppercase' }}>
              Vermisstenabgleich
            </Typography.Text>
            <ul style={{ listStyle: 'none', paddingLeft: 0 }}>
              {person.abgleiche.map((a) => (
                <li key={a.id} style={{ padding: '4px 0' }}>
                  <Tag color={a.status === 'bestaetigt' ? 'green' : a.status === 'verworfen' ? 'default' : 'gold'}>{a.status}</Tag>
                  <Typography.Text>
                    R-{String(a.vermisst_person_id === person.id ? a.gefunden_person_id : a.vermisst_person_id).padStart(3, '0')}
                  </Typography.Text>
                  {a.status === 'verdacht' && a.vermisst_person_id === person.id && (
                    <Space style={{ marginLeft: 12 }}>
                      <Button size="small" type="primary"
                        disabled={einsatz.meine_rolle !== 'einsatzleitung'}
                        onClick={() => abgleichEntscheidenMutation.mutate({
                          vermisstId: person.id, abgleichId: a.id, entscheidung: 'bestaetigt' })}>
                        Bestätigen
                      </Button>
                      <Button size="small" danger
                        disabled={einsatz.meine_rolle !== 'einsatzleitung'}
                        onClick={() => abgleichEntscheidenMutation.mutate({
                          vermisstId: person.id, abgleichId: a.id, entscheidung: 'verworfen' })}>
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
    );
  }

  function stammdatenSpalte(person: PersonDetail) {
    return (
      <Space orientation="vertical" style={{ width: '100%' }} size="large">
        {bearbeiten ? (
          <Form form={editForm} layout="vertical" initialValues={person}
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
            <Descriptions.Item label="Name">{person.name ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="Vorname">{person.vorname ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="Geschlecht">{person.geschlecht ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="Geburtsdatum">{person.geburtsdatum ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="Alter (geschätzt)">{person.alter_geschaetzt ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="Herkunft / Adresse">{person.herkunft_adresse ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="Antreffort">{person.antreff_ort ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="Melder / Kontakt">{person.melder_kontakt ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="Notiz">{person.notiz ?? '—'}</Descriptions.Item>
          </Descriptions>
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
                  onClick={() => navigate(tiereDetailPfad(einsatzId, t.id))}
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
                <Link key={sch.id} to={schadenDetailPfad(einsatzId, sch.id)}>
                  <Tag color="orange" style={{ cursor: 'pointer' }}>
                    {schadenRegistrierAnzeige(sch.registrier_nr)} {sch.typ} ({sch.ausmass}) — {sch.status}
                  </Tag>
                </Link>
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
              columns={auditSpalten}
              locale={{ emptyText: 'Noch keine Zugriffe' }}
            />
          </div>
        )}
      </Space>
    );
  }

  return (
    <div>
      <Breadcrumb
        style={{ marginBottom: 12 }}
        items={[
          { title: <Link to="/einsaetze">Einsätze</Link> },
          { title: einsatz.bezeichnung },
          { title: <Link to={zurueck}>Personen</Link> },
          { title: registrierAnzeige(p.registrier_nr) },
        ]}
      />
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }} align="start">
        <Space>
          <Typography.Title level={3} style={{ margin: 0 }}>
            Person {registrierAnzeige(p.registrier_nr)}
          </Typography.Title>
          <Tag color={STATUS_META[p.status].color}>{STATUS_META[p.status].label}</Tag>
          {p.aktuelle_sichtung && <Tag color={SK_META[p.aktuelle_sichtung].color}>{SK_META[p.aktuelle_sichtung].label}</Tag>}
          {p.storniert_at && <Tag color="default">storniert</Tag>}
        </Space>
        <Space>
          {darfSchreiben && !p.storniert_at && !bearbeiten && (
            <Space wrap>
              {naechsteStatus(p.status).map((s) => (
                <Button key={s} size="small" onClick={() => statusMutation.mutate({ personId: p.id, status: s })}>
                  → {STATUS_META[s].label}
                </Button>
              ))}
              <Button onClick={() => { setBearbeiten(true); editForm.setFieldsValue(p); }}>Bearbeiten</Button>
              <Popconfirm title="Person stornieren (Soft-Delete)?" onConfirm={() => stornoMutation.mutate(p.id)}>
                <Button danger>Stornieren</Button>
              </Popconfirm>
            </Space>
          )}
          <Button onClick={() => navigate(zurueck)}>Zurück zur Liste</Button>
        </Space>
      </Space>

      <Row gutter={24}>
        <Col xs={24} lg={12}>
          <Typography.Text type="secondary" style={{ fontSize: 12, textTransform: 'uppercase' }}>Stammdaten</Typography.Text>
          {stammdatenSpalte(p)}
        </Col>
        <Col xs={24} lg={12}>
          {medSpalte(p)}
        </Col>
      </Row>

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
