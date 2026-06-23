import { Alert, App, Breadcrumb, Button, Descriptions, Form, Input, InputNumber, Popconfirm, Select, Space, Spin, Table, Tag, Typography, type TableColumnsType } from 'antd';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ladeEinsatz } from '../api/einsaetze';
import { aktualisierePerson, ladePerson, ladePersonAudit, registrierAnzeige, setzePersonStatus, stornierePerson, type PersonEingabe } from '../api/einsatzPerson';
import { listeTiere, tierRegistrierAnzeige } from '../api/einsatzTier';
import { listeSchaeden, schadenRegistrierAnzeige } from '../api/einsatzSchaden';
import { ApiError } from '../api/client';
import { SK_META, STATUS_META } from '../personen/personMeta';
import { useTiereStream } from '../etb/useTiereStream';
import { useSchaedenStream } from '../etb/useSchaedenStream';
import type { PersonDetail, PersonStatus, PersonZugriff, Schaden, Spezies, Tier } from '../api/types';

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

export default function PersonenDetailPage() {
  const { id, personId: personIdParam } = useParams();
  const einsatzId = Number(id);
  const personId = Number(personIdParam);
  const navigate = useNavigate();

  const qc = useQueryClient();
  const { message } = App.useApp();
  const [bearbeiten, setBearbeiten] = useState(false);
  const [editForm] = Form.useForm<PersonEingabe>();

  const fehler = (e: unknown) => message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen');

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['einsatz-personen', einsatzId] });
    qc.invalidateQueries({ queryKey: ['etb', einsatzId] });
  }
  function invalidateDetail() {
    invalidate();
    qc.invalidateQueries({ queryKey: ['einsatz-person', einsatzId, personId] });
  }

  const einsatzQuery = useQuery({ queryKey: ['einsatz', einsatzId], queryFn: () => ladeEinsatz(einsatzId) });
  const detailQuery = useQuery({
    queryKey: ['einsatz-person', einsatzId, personId],
    queryFn: () => ladePerson(einsatzId, personId),
  });
  const tiereDerPersonQuery = useQuery({
    queryKey: ['einsatz-tiere', einsatzId, 'halter', personId],
    queryFn: () => listeTiere(einsatzId, { halterPersonId: personId }),
  });
  const schaedenDerPersonQuery = useQuery({
    queryKey: ['einsatz-schaeden', einsatzId, 'geschaedigt', personId],
    queryFn: () => listeSchaeden(einsatzId, { geschaedigtPersonId: personId, inklStorniert: false }),
  });
  const auditQuery = useQuery({
    queryKey: ['einsatz-person-audit', einsatzId, personId],
    queryFn: () => ladePersonAudit(einsatzId, personId),
    enabled: einsatzQuery.data?.meine_rolle === 'einsatzleitung',
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
    onSuccess: () => { invalidate(); navigate(`/einsaetze/${einsatzId}/personen`); }, onError: fehler,
  });

  useTiereStream(einsatzId);
  useSchaedenStream(einsatzId);

  if (einsatzQuery.isLoading || detailQuery.isLoading) {
    return <div style={{ textAlign: 'center', paddingTop: 80 }}><Spin size="large" /></div>;
  }
  if (einsatzQuery.isError || !einsatzQuery.data) {
    return <Alert type="error" message="Einsatz nicht gefunden oder kein Zugriff" showIcon />;
  }
  const einsatz = einsatzQuery.data;
  const zurueck = `/einsaetze/${einsatzId}/personen`;

  if (detailQuery.isError) {
    return (
      <Alert
        type="error" showIcon
        message="Person konnte nicht geladen werden"
        description={detailQuery.error instanceof ApiError ? detailQuery.error.message : undefined}
        action={<Button size="small" onClick={() => detailQuery.refetch()}>Erneut versuchen</Button>}
      />
    );
  }
  if (!detailQuery.data) {
    return <Alert type="error" message="Person nicht gefunden" showIcon />;
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

  function stammdatenSpalte(person: PersonDetail) {
    return (
      <Space direction="vertical" style={{ width: '100%' }} size="large">
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

      {stammdatenSpalte(p)}
    </div>
  );
}
