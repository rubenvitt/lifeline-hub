import { Alert, App, Breadcrumb, Button, Col, Descriptions, Form, Input, InputNumber, Modal, Popconfirm, Row, Space, Spin, Tag, Typography, theme, type TableColumnsType } from 'antd';
import { Select } from '../components/Select';
import ZeitAnzeige from '../anzeige/ZeitAnzeige';
import { useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ladeEinsatz } from '../api/einsaetze';
import { darfImEinsatzSchreiben, darfEinsatzLeiten, istEinsatzLeitung } from '../einsatz/schreibrecht';
import { useAuth } from '../auth/AuthContext';
import { aktualisierePerson, entscheideAbgleich, erfasseSichtung, erfasseVerbleib, ladePerson, ladePersonAudit, legeNotizAn, registrierAnzeige, setzePersonStatus, stornierePerson, type PersonEingabe } from '../api/einsatzPerson';
import { listeTiere, tierRegistrierAnzeige, aktualisiereTier } from '../api/einsatzTier';
import { listeSchaeden, schadenRegistrierAnzeige, aktualisiereSchaden } from '../api/einsatzSchaden';
import { listeUhs, aenderePersonBelegung } from '../api/einsatzUhs';
import { ApiError, istKonflikt } from '../api/client';
import { einsatzKeys } from '../api/queryKeys';
import { SK_META, STATUS_META, istPatient } from '../personen/personMeta';
import EinsatzSeite from '../components/EinsatzSeite';
import { flaeche } from '../theme/tokens';
import PersonVerlauf from '../personen/PersonVerlauf';
import KatalogTabelle from '../components/KatalogTabelle';
import type { PersonDetail, PersonStatus, PersonZugriff, Schaden, Sichtungskategorie, Spezies, Tier, VerbleibArt } from '../api/types';
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

export default function PersonenDetailPage() {
  const { token } = theme.useToken();
  const { id, personId: personIdParam } = useParams();
  const einsatzId = Number(id);
  const personId = Number(personIdParam);
  const idGueltig = parseRouteId(personIdParam) != null;
  const navigate = useNavigate();
  const { benutzer } = useAuth();

  const qc = useQueryClient();
  const { message, modal } = App.useApp();
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
  // LFH-152: UHS-Liste für die Klartext-Anzeige der aktuellen Verortung + den Zuweisungs-Picker.
  const uhsListeQuery = useQuery({
    queryKey: einsatzKeys.uhs(einsatzId),
    queryFn: () => listeUhs(einsatzId),
    enabled: idGueltig,
  });
  const auditQuery = useQuery({
    queryKey: einsatzKeys.personAudit(einsatzId, personId),
    queryFn: () => ladePersonAudit(einsatzId, personId),
    enabled: idGueltig && istEinsatzLeitung(einsatzQuery.data),
  });

  const statusMutation = useMutation({
    mutationFn: (v: { personId: number; status: PersonStatus }) => setzePersonStatus(einsatzId, v.personId, v.status),
    onSuccess: invalidateDetail, onError: fehler,
  });
  // Optimistisches Lock (LFH-241/F10): `basis` trägt den beim Laden gelesenen geaendert_at-Stand;
  // ein 409 öffnet den Konfliktdialog (neu laden vs. überschreiben), statt still zu überschreiben.
  const editMutation = useMutation({
    mutationFn: (v: { daten: PersonEingabe; basis?: string; overwrite?: boolean }) =>
      aktualisierePerson(einsatzId, personId, v.daten, v.overwrite ? undefined : v.basis),
    onSuccess: () => { invalidateDetail(); setBearbeiten(false); },
    onError: (e, v) => {
      if (istKonflikt(e)) {
        modal.confirm({
          title: 'Zwischenzeitlich geändert',
          content:
            'Diese Person wurde seit dem Öffnen von jemand anderem gespeichert. „Neu laden" verwirft deine Änderungen; „Überschreiben" speichert deine Werte über die des anderen.',
          okText: 'Überschreiben',
          okButtonProps: { danger: true },
          cancelText: 'Neu laden',
          onOk: () => editMutation.mutate({ daten: v.daten, overwrite: true }),
          onCancel: () => { detailQuery.refetch(); setBearbeiten(false); },
        });
      } else {
        fehler(e);
      }
    },
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

  // LFH-152: UHS-Zuweisung von der Personen-Seite (Gegenrichtung zum Grundriss). art spiegelt
  // die belegMut-Logik des Grundrisses: bereits belegt → wechsel, sonst eintritt. Austragen = austritt.
  const [uhsModalOffen, setUhsModalOffen] = useState(false);
  const [uhsForm] = Form.useForm<{ uhs_id: number; notiz?: string }>();
  function invalidateUhs() {
    invalidateDetail();
    qc.invalidateQueries({ queryKey: einsatzKeys.uhs(einsatzId) });
  }
  const belegungMutation = useMutation({
    mutationFn: (v: { uhs_id: number; notiz?: string }) =>
      aenderePersonBelegung(einsatzId, personId, {
        art: detailQuery.data?.aktuelle_uhs_id ? 'wechsel' : 'eintritt',
        uhs_id: v.uhs_id,
        notiz: v.notiz ?? null,
      }),
    onSuccess: () => { invalidateUhs(); setUhsModalOffen(false); uhsForm.resetFields(); },
    onError: fehler,
  });
  const austrittMutation = useMutation({
    mutationFn: () => aenderePersonBelegung(einsatzId, personId, { art: 'austritt' }),
    onSuccess: invalidateUhs,
    onError: fehler,
  });

  // LFH-151: Tiere (Halter) / Schäden (Geschädigte) von der Personen-Seite zuweisen + lösen.
  // Picker-Listen lazy (nur bei offenem Modal) laden; Zuweisen leert die konkurrierenden
  // XOR-Slots im selben PATCH (sonst 500 durch den Mehrspalten-CHECK — PATCH-XOR).
  const [tierModalOffen, setTierModalOffen] = useState(false);
  const [schadenModalOffen, setSchadenModalOffen] = useState(false);
  const [tierForm] = Form.useForm<{ tier_id: number }>();
  const [schadenForm] = Form.useForm<{ schaden_id: number }>();
  function invalidateZuordnung() {
    invalidateDetail();
    qc.invalidateQueries({ queryKey: einsatzKeys.tiere(einsatzId) });
    qc.invalidateQueries({ queryKey: einsatzKeys.schaeden(einsatzId) });
    qc.invalidateQueries({ queryKey: einsatzKeys.tiereHalter(einsatzId, personId) });
    qc.invalidateQueries({ queryKey: einsatzKeys.schaedenGeschaedigt(einsatzId, personId) });
  }
  const freieTiereQuery = useQuery({
    queryKey: einsatzKeys.tiere(einsatzId),
    queryFn: () => listeTiere(einsatzId),
    enabled: idGueltig && tierModalOffen,
  });
  const freieSchaedenQuery = useQuery({
    queryKey: einsatzKeys.schaeden(einsatzId),
    queryFn: () => listeSchaeden(einsatzId, { inklStorniert: false }),
    enabled: idGueltig && schadenModalOffen,
  });
  const tierZuweisenMut = useMutation({
    mutationFn: (tierId: number) =>
      aktualisiereTier(einsatzId, tierId, { halter_person_id: personId, halter_kontakt: null }),
    onSuccess: () => { invalidateZuordnung(); setTierModalOffen(false); tierForm.resetFields(); },
    onError: fehler,
  });
  const tierLoesenMut = useMutation({
    mutationFn: (tierId: number) => aktualisiereTier(einsatzId, tierId, { halter_person_id: null }),
    onSuccess: invalidateZuordnung, onError: fehler,
  });
  const schadenZuweisenMut = useMutation({
    mutationFn: (schadenId: number) =>
      aktualisiereSchaden(einsatzId, schadenId, {
        geschaedigt_person_id: personId, geschaedigt_personal_id: null,
        geschaedigt_organisation_id: null, geschaedigt_kontakt: null,
      }),
    onSuccess: () => { invalidateZuordnung(); setSchadenModalOffen(false); schadenForm.resetFields(); },
    onError: fehler,
  });
  const schadenLoesenMut = useMutation({
    mutationFn: (schadenId: number) => aktualisiereSchaden(einsatzId, schadenId, { geschaedigt_person_id: null }),
    onSuccess: invalidateZuordnung, onError: fehler,
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
        action={<Button onClick={() => detailQuery.refetch()}>Erneut versuchen</Button>}
      />
    );
  }
  if (!detailQuery.data) {
    return <Alert type="error" title="Person nicht gefunden" showIcon />;
  }
  const p = detailQuery.data;

  const darfSchreiben = darfImEinsatzSchreiben(einsatz, benutzer);
  const darfZuordnen = darfSchreiben && !p.storniert_at;

  // LFH-151: Picker-Kandidaten = FREIE Ziele (kein Halter/Geschädigter, nicht storniert,
  // Schaden nicht abgeschlossen). Kein stilles Überschreiben fremder Zuordnungen.
  const freieTiere = (freieTiereQuery.data ?? []).filter(
    (t) => t.halter_person_id == null && t.halter_kontakt == null && t.storniert_at == null,
  );
  const freieSchaeden = (freieSchaedenQuery.data ?? []).filter(
    (s) =>
      s.geschaedigt_person_id == null && s.geschaedigt_personal_id == null &&
      s.geschaedigt_organisation_id == null && s.geschaedigt_kontakt == null &&
      s.storniert_at == null && s.status !== 'abgeschlossen',
  );

  const auditSpalten: TableColumnsType<PersonZugriff> = [
    { title: 'Wann', dataIndex: 'zugriff_at', key: 'zugriff_at', render: (v: string) => <ZeitAnzeige wert={v} format="dtgVoll" /> },
    { title: 'Wer', dataIndex: 'benutzer_name', key: 'benutzer_name' },
    { title: 'Art', dataIndex: 'art', key: 'art' },
  ];

  function medSpalte(person: PersonDetail) {
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
              <Button onClick={() => statusMutation.mutate({ personId: person.id, status: 'verstorben' })}>
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
          <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM, textTransform: 'uppercase' }}>
            Chronologischer Verlauf (neueste zuerst)
          </Typography.Text>
          <PersonVerlauf person={person} />
        </div>
        {(person.abgleiche?.length ?? 0) > 0 && (
          <div>
            <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM, textTransform: 'uppercase' }}>
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
                      <Button type="primary"
                        disabled={!darfEinsatzLeiten(einsatz, benutzer)}
                        onClick={() => abgleichEntscheidenMutation.mutate({
                          vermisstId: person.id, abgleichId: a.id, entscheidung: 'bestaetigt' })}>
                        Bestätigen
                      </Button>
                      <Button danger
                        disabled={!darfEinsatzLeiten(einsatz, benutzer)}
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
            onFinish={(daten) => editMutation.mutate({ daten, basis: person.geaendert_at })}>
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
          <Descriptions column={1} bordered>
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
          <Space wrap>
            <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM, textTransform: 'uppercase' }}>
              Zugeordnete Tiere
            </Typography.Text>
            {darfZuordnen && (
              <Button onClick={() => { tierForm.resetFields(); setTierModalOffen(true); }}>
                Tier zuweisen
              </Button>
            )}
          </Space>
          {(tiereDerPersonQuery.data?.length ?? 0) === 0 ? (
            <div><Typography.Text type="secondary">keine</Typography.Text></div>
          ) : (
            <Space wrap style={{ marginTop: 4 }}>
              {(tiereDerPersonQuery.data ?? []).map((t: Tier) => (
                <Space key={t.id} size={4}>
                  <Tag
                    color="cyan"
                    style={{ cursor: 'pointer' }}
                    onClick={() => navigate(tiereDetailPfad(einsatzId, t.id))}
                  >
                    {tierRegistrierAnzeige(t.registrier_nr)} {TIER_SPEZIES_LABEL[t.spezies] ?? t.spezies}
                    {t.rufname ? ` „${t.rufname}"` : ''}
                  </Tag>
                  {darfZuordnen && (
                    <Button type="text" onClick={() => tierLoesenMut.mutate(t.id)}>lösen</Button>
                  )}
                </Space>
              ))}
            </Space>
          )}
        </div>

        <div>
          <Space wrap>
            <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM, textTransform: 'uppercase' }}>
              Als Geschädigte bei Schäden
            </Typography.Text>
            {darfZuordnen && (
              <Button onClick={() => { schadenForm.resetFields(); setSchadenModalOffen(true); }}>
                Schaden zuweisen
              </Button>
            )}
          </Space>
          {(schaedenDerPersonQuery.data?.length ?? 0) === 0 ? (
            <div><Typography.Text type="secondary">keine</Typography.Text></div>
          ) : (
            <Space wrap style={{ marginTop: 4 }}>
              {(schaedenDerPersonQuery.data ?? []).map((sch: Schaden) => (
                <Space key={sch.id} size={4}>
                  <Link to={schadenDetailPfad(einsatzId, sch.id)}>
                    <Tag color="orange" style={{ cursor: 'pointer' }}>
                      {schadenRegistrierAnzeige(sch.registrier_nr)} {sch.typ} ({sch.ausmass}) — {sch.status}
                    </Tag>
                  </Link>
                  {darfZuordnen && (
                    <Button type="text" onClick={() => schadenLoesenMut.mutate(sch.id)}>lösen</Button>
                  )}
                </Space>
              ))}
            </Space>
          )}
        </div>

        <div>
          <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM, textTransform: 'uppercase' }}>
            UHS-Verortung
          </Typography.Text>
          <div style={{ marginTop: 4 }}>
            {person.aktuelle_uhs_id != null ? (
              <Space wrap>
                <Tag color="blue">
                  {uhsListeQuery.data?.find((u) => u.id === person.aktuelle_uhs_id)?.bezeichnung
                    ?? `UHS #${person.aktuelle_uhs_id}`}
                </Tag>
                {darfSchreiben && !person.storniert_at && (
                  <>
                    <Button onClick={() => { uhsForm.resetFields(); setUhsModalOffen(true); }}>
                      UHS ändern
                    </Button>
                    <Button danger onClick={() => austrittMutation.mutate()}>Austragen</Button>
                  </>
                )}
              </Space>
            ) : (
              <Space wrap>
                <Typography.Text type="secondary">keiner UHS zugewiesen</Typography.Text>
                {darfSchreiben && !person.storniert_at && !person.aktueller_verbleib && (
                  <Button onClick={() => { uhsForm.resetFields(); setUhsModalOffen(true); }}>
                    UHS zuweisen
                  </Button>
                )}
              </Space>
            )}
          </div>
        </div>

        {istEinsatzLeitung(einsatz) && (
          <div>
            <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM, textTransform: 'uppercase' }}>
              Zugriffs-Audit
            </Typography.Text>
            <KatalogTabelle<PersonZugriff>
              rowKey="id" pagination={false}
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
    <EinsatzSeite
      breite={flaeche.seiteBreit}
      titel={
        <Space>
          Person {registrierAnzeige(p.registrier_nr)}
          {/* BEFUND: `STATUS_META`/`SK_META` (`personen/personMeta.ts`) bleiben antd-Farbnamen.
              Spec §5 zieht die Grenze bewusst — `PersonStatus`/`Sichtungskategorie` sind keine
              Vertrags-Enums (§1.3), und die Sichtungskategorien tragen mit SK I–IV eine eigene,
              genormte Farbsprache, die keine Statusrolle abbilden kann. Der Kopf wandert, die
              Tags bleiben. */}
          <Tag color={STATUS_META[p.status].color}>{STATUS_META[p.status].label}</Tag>
          {p.aktuelle_sichtung && <Tag color={SK_META[p.aktuelle_sichtung].color}>{SK_META[p.aktuelle_sichtung].label}</Tag>}
          {p.storniert_at && <Tag color="default">storniert</Tag>}
        </Space>
      }
      breadcrumb={
        <Breadcrumb
          items={[
            { title: <Link to="/einsaetze">Einsätze</Link> },
            { title: einsatz.bezeichnung },
            { title: <Link to={zurueck}>Personen</Link> },
            { title: registrierAnzeige(p.registrier_nr) },
          ]}
        />
      }
      aktionen={
        <Space>
          {darfSchreiben && !p.storniert_at && !bearbeiten && (
            <Space wrap>
              {naechsteStatus(p.status).map((s) => (
                <Button key={s} onClick={() => statusMutation.mutate({ personId: p.id, status: s })}>
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
      }
    >
      <Row gutter={24}>
        <Col xs={24} lg={12}>
          <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM, textTransform: 'uppercase' }}>Stammdaten</Typography.Text>
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

      <Modal
        open={uhsModalOffen}
        title="UHS zuweisen"
        okText="Zuweisen"
        confirmLoading={belegungMutation.isPending}
        onOk={() => uhsForm.submit()}
        onCancel={() => { setUhsModalOffen(false); uhsForm.resetFields(); }}
        destroyOnHidden
      >
        <Form form={uhsForm} layout="vertical" onFinish={(v) => belegungMutation.mutate(v)}>
          <Form.Item label="Unfallhilfsstelle" name="uhs_id" rules={[{ required: true, message: 'Bitte UHS wählen' }]}>
            <Select
              placeholder="aktive UHS wählen"
              options={(uhsListeQuery.data ?? [])
                .filter((u) => u.status === 'aktiv')
                .map((u) => ({ value: u.id, label: u.bezeichnung }))}
            />
          </Form.Item>
          <Form.Item label="Notiz (optional)" name="notiz"><Input /></Form.Item>
        </Form>
      </Modal>

      <Modal
        open={tierModalOffen}
        title="Tier als Halter zuweisen"
        okText="Zuweisen"
        confirmLoading={tierZuweisenMut.isPending}
        onOk={() => tierForm.submit()}
        onCancel={() => { setTierModalOffen(false); tierForm.resetFields(); }}
        destroyOnHidden
      >
        <Form form={tierForm} layout="vertical" onFinish={(v) => tierZuweisenMut.mutate(v.tier_id)}>
          <Form.Item label="Tier" name="tier_id" rules={[{ required: true, message: 'Bitte Tier wählen' }]}>
            <Select
              placeholder="freies Tier wählen"
              loading={freieTiereQuery.isLoading}
              notFoundContent={freieTiereQuery.isLoading ? '…' : 'keine freien Tiere'}
              options={freieTiere.map((t) => ({
                value: t.id,
                label: `${tierRegistrierAnzeige(t.registrier_nr)} ${TIER_SPEZIES_LABEL[t.spezies] ?? t.spezies}${t.rufname ? ` „${t.rufname}"` : ''}`,
              }))}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={schadenModalOffen}
        title="Schaden zuweisen (Geschädigte)"
        okText="Zuweisen"
        confirmLoading={schadenZuweisenMut.isPending}
        onOk={() => schadenForm.submit()}
        onCancel={() => { setSchadenModalOffen(false); schadenForm.resetFields(); }}
        destroyOnHidden
      >
        <Form form={schadenForm} layout="vertical" onFinish={(v) => schadenZuweisenMut.mutate(v.schaden_id)}>
          <Form.Item label="Schaden" name="schaden_id" rules={[{ required: true, message: 'Bitte Schaden wählen' }]}>
            <Select
              placeholder="freien Schaden wählen"
              loading={freieSchaedenQuery.isLoading}
              notFoundContent={freieSchaedenQuery.isLoading ? '…' : 'keine freien Schäden'}
              options={freieSchaeden.map((s) => ({
                value: s.id,
                label: `${schadenRegistrierAnzeige(s.registrier_nr)} ${s.typ} (${s.ausmass})`,
              }))}
            />
          </Form.Item>
        </Form>
      </Modal>
    </EinsatzSeite>
  );
}
