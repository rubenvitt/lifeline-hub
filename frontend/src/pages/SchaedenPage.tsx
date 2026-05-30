import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  App,
  Button,
  Descriptions,
  Drawer,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
} from 'antd';
import type { TableColumnsType } from 'antd';
import { ApiError } from '../api/client';
import { ladeEinsatz } from '../api/einsaetze';
import {
  aktualisiereSchaden,
  ladeSchaden,
  legeSchadenAn,
  listeSchaeden,
  schadenRegistrierAnzeige,
  schliesseSchadenAb,
  storniereSchaden,
  uebergebeSchaden,
  type SchadenEingabe,
  type SchadenPatch,
} from '../api/einsatzSchaden';
import type {
  Ausmass,
  Schaden,
  SchadenAbschlussGrund,
  SchadenStatus,
  SchadenTyp,
} from '../api/types';
import { useSchaedenStream } from '../etb/useSchaedenStream';
import GeschaedigtPicker, { type GeschaedigtWert } from './schaeden/GeschaedigtPicker';

const STATUS_META: Record<SchadenStatus, { label: string; color: string }> = {
  offen: { label: 'offen', color: 'gold' },
  uebergeben: { label: 'übergeben', color: 'blue' },
  abgeschlossen: { label: 'abgeschlossen', color: 'default' },
};

const TYP_LABEL: Record<SchadenTyp, string> = {
  sachschaden: 'Sachschaden',
  verkehrshindernis: 'Verkehrshindernis',
  infrastruktur: 'Infrastruktur',
  umweltschaden: 'Umweltschaden',
  tierkadaver: 'Tierkadaver',
  sonstige: 'Sonstige',
};

const AUSMASS_META: Record<Ausmass, { label: string; color: string }> = {
  gering: { label: 'gering', color: 'green' },
  mittel: { label: 'mittel', color: 'gold' },
  gross: { label: 'groß', color: 'orange' },
  katastrophal: { label: 'katastrophal', color: 'red' },
};

const ABSCHLUSS_LABEL: Record<SchadenAbschlussGrund, string> = {
  behoben: 'behoben',
  kein_handlungsbedarf: 'kein Handlungsbedarf',
  abgewiesen: 'abgewiesen',
};

const ABSCHLUSS_GRUENDE = (Object.keys(ABSCHLUSS_LABEL) as SchadenAbschlussGrund[]).map((g) => ({
  value: g,
  label: ABSCHLUSS_LABEL[g],
}));

type Sicht = 'offen' | 'uebergeben' | 'abgeschlossen' | 'alle';
const SICHTEN: { key: Sicht; label: string }[] = [
  { key: 'offen', label: 'Offen' },
  { key: 'uebergeben', label: 'Übergeben' },
  { key: 'abgeschlossen', label: 'Abgeschlossen' },
  { key: 'alle', label: 'Alle' },
];

function pad3(nr: number): string {
  return String(nr).padStart(3, '0');
}

function geschaedigtAnzeige(s: Schaden): React.ReactNode {
  if (s.geschaedigt_registrier_nr != null) {
    const label = `R-${pad3(s.geschaedigt_registrier_nr)}`;
    return s.geschaedigt_storniert_at ? (
      <Typography.Text type="secondary">Geschädigt (storniert): {label}</Typography.Text>
    ) : (
      <Tag color="blue">{label}</Tag>
    );
  }
  if (s.geschaedigt_personal_id != null) {
    return <Tag color="geekblue">{s.geschaedigt_personal_name ?? 'Einsatzkraft'}</Tag>;
  }
  if (s.geschaedigt_organisation_id != null) {
    return <Tag color="purple">{s.geschaedigt_organisation_name ?? 'Eigene Organisation'}</Tag>;
  }
  if (s.geschaedigt_kontakt) return <Typography.Text>{s.geschaedigt_kontakt}</Typography.Text>;
  return <Typography.Text type="secondary">—</Typography.Text>;
}

/** Strukturierten Geschädigt-Wert aus einem geladenen Schaden ableiten (Edit-Seeding). */
function geschaedigtAusSchaden(s: Schaden): GeschaedigtWert {
  if (s.geschaedigt_person_id != null) {
    return {
      typ: 'person',
      refId: s.geschaedigt_person_id,
      label:
        s.geschaedigt_registrier_nr != null ? `R-${pad3(s.geschaedigt_registrier_nr)}` : 'Betroffene Person',
    };
  }
  if (s.geschaedigt_personal_id != null) {
    return { typ: 'personal', refId: s.geschaedigt_personal_id, label: s.geschaedigt_personal_name ?? 'Einsatzkraft' };
  }
  if (s.geschaedigt_organisation_id != null) {
    return { typ: 'organisation', label: s.geschaedigt_organisation_name ?? 'Eigene Organisation' };
  }
  if (s.geschaedigt_kontakt) return { typ: 'extern', kontakt: s.geschaedigt_kontakt };
  return null;
}

/** GeschaedigtWert → die vier Backend-Felder (genau eines gesetzt). orgId für die eigene Org. */
function geschaedigtFelder(
  wert: GeschaedigtWert,
  orgId: number,
): {
  geschaedigt_person_id: number | null;
  geschaedigt_personal_id: number | null;
  geschaedigt_organisation_id: number | null;
  geschaedigt_kontakt: string | null;
} {
  const leer = {
    geschaedigt_person_id: null,
    geschaedigt_personal_id: null,
    geschaedigt_organisation_id: null,
    geschaedigt_kontakt: null,
  };
  if (wert == null) return leer;
  switch (wert.typ) {
    case 'person':
      return { ...leer, geschaedigt_person_id: wert.refId };
    case 'personal':
      return { ...leer, geschaedigt_personal_id: wert.refId };
    case 'organisation':
      return { ...leer, geschaedigt_organisation_id: orgId };
    case 'extern':
      return { ...leer, geschaedigt_kontakt: wert.kontakt };
  }
}

export default function SchaedenPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const [searchParams] = useSearchParams();
  const { message } = App.useApp();
  const qc = useQueryClient();

  const [sicht, setSicht] = useState<Sicht>('offen');
  const [typFilter, setTypFilter] = useState<SchadenTyp | undefined>(undefined);
  const [ausmassFilter, setAusmassFilter] = useState<Ausmass | undefined>(undefined);
  const [suche, setSuche] = useState('');

  const [offenerSchadenId, setOffenerSchadenId] = useState<number | null>(null);
  const [bearbeiten, setBearbeiten] = useState(false);
  const [erfassenOffen, setErfassenOffen] = useState(false);
  const [uebergebenOffen, setUebergebenOffen] = useState(false);
  const [abschlussOffen, setAbschlussOffen] = useState(false);

  const [erfassForm] = Form.useForm<SchadenEingabe>();
  const [editForm] = Form.useForm<SchadenPatch>();
  const [uebergebForm] = Form.useForm<{ uebergeben_an: string }>();
  const [abschlussForm] = Form.useForm<{ abschluss_grund: string; notiz?: string }>();

  // Geschädigt ist ein strukturierter Wert → lokaler State (kein Form.Item).
  const [erfassGeschaedigt, setErfassGeschaedigt] = useState<GeschaedigtWert>(null);
  const [editGeschaedigt, setEditGeschaedigt] = useState<GeschaedigtWert>(null);

  useSchaedenStream(einsatzId);

  const einsatzQuery = useQuery({ queryKey: ['einsatz', einsatzId], queryFn: () => ladeEinsatz(einsatzId) });
  const schaedenQuery = useQuery({
    queryKey: ['einsatz-schaeden', einsatzId],
    queryFn: () => listeSchaeden(einsatzId),
  });
  const detailQuery = useQuery({
    queryKey: ['einsatz-schaden', einsatzId, offenerSchadenId],
    queryFn: () => ladeSchaden(einsatzId, offenerSchadenId!),
    enabled: offenerSchadenId != null,
  });

  useEffect(() => {
    const ziel = searchParams.get('schaden');
    const n = Number(ziel);
    if (ziel && !Number.isNaN(n)) setOffenerSchadenId(n);
  }, [searchParams]);

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['einsatz-schaeden', einsatzId] });
    qc.invalidateQueries({ queryKey: ['einsatz-schaden', einsatzId] });
    qc.invalidateQueries({ queryKey: ['etb', einsatzId] });
  }
  const fehler = (e: unknown) => message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen');

  const anlegenMutation = useMutation({
    mutationFn: (v: SchadenEingabe) => legeSchadenAn(einsatzId, v),
    onSuccess: () => {
      invalidate();
      setErfassenOffen(false);
      erfassForm.resetFields();
      setErfassGeschaedigt(null);
    },
    onError: fehler,
  });
  const editMutation = useMutation({
    mutationFn: (v: SchadenPatch) => aktualisiereSchaden(einsatzId, offenerSchadenId!, v),
    onSuccess: () => {
      invalidate();
      setBearbeiten(false);
    },
    onError: fehler,
  });
  const uebergebMutation = useMutation({
    mutationFn: (an: string) => uebergebeSchaden(einsatzId, offenerSchadenId!, an),
    onSuccess: () => {
      invalidate();
      setUebergebenOffen(false);
      uebergebForm.resetFields();
    },
    onError: fehler,
  });
  const abschlussMutation = useMutation({
    mutationFn: (v: { abschluss_grund: string; notiz?: string }) =>
      schliesseSchadenAb(einsatzId, offenerSchadenId!, v.abschluss_grund, v.notiz),
    onSuccess: () => {
      invalidate();
      setAbschlussOffen(false);
      abschlussForm.resetFields();
    },
    onError: fehler,
  });
  const stornoMutation = useMutation({
    mutationFn: () => storniereSchaden(einsatzId, offenerSchadenId!),
    onSuccess: () => {
      invalidate();
      setOffenerSchadenId(null);
    },
    onError: fehler,
  });

  const einsatz = einsatzQuery.data;
  const darfSchreiben =
    einsatz?.status === 'aktiv' &&
    (einsatz?.meine_rolle === 'einsatzleitung' || einsatz?.meine_rolle === 'fuehrungspersonal');

  const alle = schaedenQuery.data ?? [];
  const sichtbar = alle
    .filter((s) => sicht === 'alle' || s.status === sicht)
    .filter((s) => !typFilter || s.typ === typFilter)
    .filter((s) => !ausmassFilter || s.ausmass === ausmassFilter)
    .filter((s) => {
      if (!suche.trim()) return true;
      const q = suche.toLowerCase();
      return s.ort.toLowerCase().includes(q) || s.beschreibung.toLowerCase().includes(q);
    });

  const spalten: TableColumnsType<Schaden> = [
    {
      title: 'Nr.',
      dataIndex: 'registrier_nr',
      render: (nr: number) => <strong>{schadenRegistrierAnzeige(nr)}</strong>,
    },
    { title: 'Typ', dataIndex: 'typ', render: (t: SchadenTyp) => <Tag>{TYP_LABEL[t]}</Tag> },
    {
      title: 'Ausmaß',
      dataIndex: 'ausmass',
      render: (a: Ausmass) => <Tag color={AUSMASS_META[a].color}>{AUSMASS_META[a].label}</Tag>,
    },
    { title: 'Ort', dataIndex: 'ort', ellipsis: true },
    {
      title: 'Status',
      dataIndex: 'status',
      render: (st: SchadenStatus, row) => (
        <Tag color={STATUS_META[st].color}>
          {STATUS_META[st].label}
          {st === 'uebergeben' && row.uebergeben_an ? ` (${row.uebergeben_an})` : ''}
        </Tag>
      ),
    },
    { title: 'Geschädigt', key: 'geschaedigt', render: (_, row) => geschaedigtAnzeige(row) },
  ];

  const orgId = einsatz?.org_id ?? 0;

  function onErfassen(daten: SchadenEingabe) {
    anlegenMutation.mutate({
      typ: daten.typ,
      ausmass: daten.ausmass,
      ort: daten.ort,
      beschreibung: daten.beschreibung ?? null,
      ...geschaedigtFelder(erfassGeschaedigt, orgId),
    });
  }

  function onEdit(daten: SchadenPatch) {
    editMutation.mutate({
      typ: daten.typ,
      ausmass: daten.ausmass,
      ort: daten.ort,
      beschreibung: daten.beschreibung,
      // Patch ersetzt die Auswahl: immer alle vier Felder explizit senden.
      ...geschaedigtFelder(editGeschaedigt, orgId),
    });
  }

  const s = detailQuery.data;

  return (
    <div style={{ padding: 16 }}>
      <Space style={{ marginBottom: 12, justifyContent: 'space-between', width: '100%' }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Schäden
        </Typography.Title>
        {darfSchreiben && (
          <Button
            type="primary"
            onClick={() => {
              setErfassGeschaedigt(null);
              erfassForm.resetFields();
              setErfassenOffen(true);
            }}
          >
            Schnellerfassung
          </Button>
        )}
      </Space>

      <Tabs
        activeKey={sicht}
        onChange={(k) => setSicht(k as Sicht)}
        items={SICHTEN.map((s) => ({ key: s.key, label: s.label }))}
      />
      <Space wrap style={{ marginBottom: 12 }}>
        <Select
          allowClear
          placeholder="Typ"
          style={{ width: 180 }}
          value={typFilter}
          onChange={setTypFilter}
          options={(Object.keys(TYP_LABEL) as SchadenTyp[]).map((t) => ({ value: t, label: TYP_LABEL[t] }))}
        />
        <Select
          allowClear
          placeholder="Ausmaß"
          style={{ width: 160 }}
          value={ausmassFilter}
          onChange={setAusmassFilter}
          options={(Object.keys(AUSMASS_META) as Ausmass[]).map((a) => ({ value: a, label: AUSMASS_META[a].label }))}
        />
        <Input.Search
          placeholder="Ort/Beschreibung"
          allowClear
          style={{ width: 220 }}
          onChange={(e) => setSuche(e.target.value)}
        />
      </Space>

      <Table
        rowKey="id"
        loading={schaedenQuery.isLoading}
        dataSource={sichtbar}
        columns={spalten}
        pagination={false}
        locale={{ emptyText: 'Keine Schäden in dieser Sicht' }}
        onRow={(row) => ({
          onClick: () => {
            setOffenerSchadenId(row.id);
            setBearbeiten(false);
          },
          style: { cursor: 'pointer' },
        })}
      />

      {/* Schnellerfassung */}
      <Modal
        title="Schaden erfassen"
        open={erfassenOffen}
        onCancel={() => setErfassenOffen(false)}
        onOk={() => erfassForm.submit()}
        okText="Anlegen"
        confirmLoading={anlegenMutation.isPending}
        destroyOnHidden
      >
        <Form form={erfassForm} layout="vertical" onFinish={onErfassen}>
          <Form.Item label="Typ" name="typ" rules={[{ required: true, message: 'Typ ist Pflicht' }]}>
            <Select options={(Object.keys(TYP_LABEL) as SchadenTyp[]).map((t) => ({ value: t, label: TYP_LABEL[t] }))} />
          </Form.Item>
          <Form.Item label="Ausmaß" name="ausmass" rules={[{ required: true, message: 'Ausmaß ist Pflicht' }]}>
            <Select options={(Object.keys(AUSMASS_META) as Ausmass[]).map((a) => ({ value: a, label: AUSMASS_META[a].label }))} />
          </Form.Item>
          <Form.Item label="Ort" name="ort" rules={[{ required: true, message: 'Ort ist Pflicht' }]}>
            <Input placeholder="z. B. Hauptstr. 17 oder L 235 km 12,5" />
          </Form.Item>
          <Form.Item label="Beschreibung" name="beschreibung">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item label="Geschädigt">
            <GeschaedigtPicker
              einsatzId={einsatzId}
              orgName={einsatz?.org_name ?? 'Eigene Organisation'}
              value={erfassGeschaedigt}
              onChange={setErfassGeschaedigt}
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* Detail-Drawer */}
      <Drawer
        width={520}
        open={offenerSchadenId != null}
        onClose={() => setOffenerSchadenId(null)}
        title={s ? `${schadenRegistrierAnzeige(s.registrier_nr)} · ${TYP_LABEL[s.typ]}` : 'Schaden'}
        loading={detailQuery.isLoading}
      >
        {s && (
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            <Space wrap>
              <Tag color={STATUS_META[s.status].color}>{STATUS_META[s.status].label}</Tag>
              <Tag color={AUSMASS_META[s.ausmass].color}>{AUSMASS_META[s.ausmass].label}</Tag>
              {s.storniert_at && <Tag color="red">storniert</Tag>}
            </Space>

            {darfSchreiben && !s.storniert_at && (
              <Space wrap>
                <Button size="small" disabled={s.status !== 'offen'} onClick={() => setUebergebenOffen(true)}>
                  Übergeben
                </Button>
                <Button
                  size="small"
                  disabled={s.status === 'abgeschlossen'}
                  onClick={() => setAbschlussOffen(true)}
                >
                  Abschließen
                </Button>
              </Space>
            )}

            {!bearbeiten ? (
              <Descriptions column={1} size="small" bordered>
                <Descriptions.Item label="Ort">{s.ort}</Descriptions.Item>
                <Descriptions.Item label="Beschreibung">{s.beschreibung || '—'}</Descriptions.Item>
                <Descriptions.Item label="Geschädigt">{geschaedigtAnzeige(s)}</Descriptions.Item>
                {s.status !== 'offen' && (
                  <Descriptions.Item label="Übergeben an">{s.uebergeben_an || '—'}</Descriptions.Item>
                )}
                {s.status === 'abgeschlossen' && (
                  <Descriptions.Item label="Abschlussgrund">
                    {s.abschluss_grund ? ABSCHLUSS_LABEL[s.abschluss_grund] : '—'}
                  </Descriptions.Item>
                )}
              </Descriptions>
            ) : (
              <Form
                form={editForm}
                layout="vertical"
                onFinish={onEdit}
                initialValues={{
                  typ: s.typ,
                  ausmass: s.ausmass,
                  ort: s.ort,
                  beschreibung: s.beschreibung,
                }}
              >
                <Form.Item label="Typ" name="typ">
                  <Select options={(Object.keys(TYP_LABEL) as SchadenTyp[]).map((t) => ({ value: t, label: TYP_LABEL[t] }))} />
                </Form.Item>
                <Form.Item label="Ausmaß" name="ausmass">
                  <Select options={(Object.keys(AUSMASS_META) as Ausmass[]).map((a) => ({ value: a, label: AUSMASS_META[a].label }))} />
                </Form.Item>
                <Form.Item label="Ort" name="ort" rules={[{ required: true, message: 'Ort ist Pflicht' }]}>
                  <Input />
                </Form.Item>
                <Form.Item label="Beschreibung" name="beschreibung">
                  <Input.TextArea rows={2} />
                </Form.Item>
                <Form.Item label="Geschädigt">
                  <GeschaedigtPicker
                    einsatzId={einsatzId}
                    orgName={einsatz?.org_name ?? 'Eigene Organisation'}
                    value={editGeschaedigt}
                    onChange={setEditGeschaedigt}
                  />
                </Form.Item>
                <Space>
                  <Button type="primary" htmlType="submit" loading={editMutation.isPending}>
                    Speichern
                  </Button>
                  <Button onClick={() => setBearbeiten(false)}>Abbrechen</Button>
                </Space>
              </Form>
            )}

            {darfSchreiben && !s.storniert_at && !bearbeiten && (
              <Space>
                <Button
                  onClick={() => {
                    setEditGeschaedigt(geschaedigtAusSchaden(s));
                    setBearbeiten(true);
                  }}
                >
                  Bearbeiten
                </Button>
                <Popconfirm title="Schaden stornieren?" onConfirm={() => stornoMutation.mutate()} okText="Stornieren">
                  <Button danger>Stornieren</Button>
                </Popconfirm>
              </Space>
            )}
          </Space>
        )}
      </Drawer>

      {/* Übergeben-Modal */}
      <Modal
        title="Schaden übergeben"
        open={uebergebenOffen}
        onCancel={() => setUebergebenOffen(false)}
        onOk={() => uebergebForm.submit()}
        okText="Übergeben"
        confirmLoading={uebergebMutation.isPending}
        destroyOnHidden
      >
        <Form form={uebergebForm} layout="vertical" onFinish={(v) => uebergebMutation.mutate(v.uebergeben_an)}>
          <Form.Item
            label="Übergeben an"
            name="uebergeben_an"
            rules={[{ required: true, message: 'Adressat ist Pflicht' }]}
          >
            <Input placeholder="z. B. Stadtwerke, Bauhof, Umweltamt" />
          </Form.Item>
        </Form>
      </Modal>

      {/* Abschließen-Modal */}
      <Modal
        title="Schaden abschließen"
        open={abschlussOffen}
        onCancel={() => setAbschlussOffen(false)}
        onOk={() => abschlussForm.submit()}
        okText="Abschließen"
        confirmLoading={abschlussMutation.isPending}
        destroyOnHidden
      >
        <Form form={abschlussForm} layout="vertical" onFinish={(v) => abschlussMutation.mutate(v)}>
          <Form.Item
            label="Abschlussgrund"
            name="abschluss_grund"
            rules={[{ required: true, message: 'Grund ist Pflicht' }]}
          >
            <Select options={ABSCHLUSS_GRUENDE} />
          </Form.Item>
          <Form.Item label="Notiz (optional, wird an Beschreibung angehängt)" name="notiz">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
