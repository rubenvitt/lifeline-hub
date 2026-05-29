import { Alert, App, Breadcrumb, Button, Descriptions, Drawer, Form, Input, InputNumber, Modal, Popconfirm, Radio, Select, Space, Spin, Table, Tabs, Tag, Typography, type TableColumnsType } from 'antd';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ladeEinsatz } from '../api/einsaetze';
import {
  aktualisiereTier, ladeTier, legeTierAn, listeTiere, setzeTierStatus, storniereTier,
  tierRegistrierAnzeige, type TierEingabe, type TierPatch,
} from '../api/einsatzTier';
import { ApiError } from '../api/client';
import { useTiereStream } from '../etb/useTiereStream';
import type { AbschlussGrund, Spezies, Tier, TierStatus } from '../api/types';

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

const ABSCHLUSS_META: Record<AbschlussGrund, string> = {
  uebergabe_halter: 'Übergabe an Halter', uebergabe_tierarzt: 'Übergabe an Tierarzt',
  uebergabe_tierheim: 'Übergabe an Tierheim', verstorben: 'verstorben',
  freilauf: 'Freilauf', sonstiges: 'Sonstiges',
};

/** Status-Sichten: 'alle' = kein Filter; sonst Status-Filter. */
type Sicht = 'aktiv' | 'vermisst' | 'abgeschlossen' | 'alle';
const SICHTEN: { key: Sicht; label: string }[] = [
  { key: 'aktiv', label: 'Aktiv' },
  { key: 'vermisst', label: 'Vermisst' },
  { key: 'abgeschlossen', label: 'Abgeschlossen' },
  { key: 'alle', label: 'Alle' },
];

/** Erlaubte Folge-Status (Spiegel von darf_uebergehen im Backend). */
function naechsteStatus(aktuell: TierStatus): TierStatus[] {
  switch (aktuell) {
    case 'aktiv': return ['vermisst', 'abgeschlossen'];
    case 'vermisst': return ['aktiv', 'abgeschlossen'];
    case 'abgeschlossen': return ['aktiv', 'vermisst'];
  }
}

/** Halter-Kurzanzeige für Liste + Drawer. */
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

  useTiereStream(einsatzId);

  const einsatzQuery = useQuery({ queryKey: ['einsatz', einsatzId], queryFn: () => ladeEinsatz(einsatzId) });
  const tiereQuery = useQuery({ queryKey: ['einsatz-tiere', einsatzId], queryFn: () => listeTiere(einsatzId) });

  const qc = useQueryClient();
  const { message } = App.useApp();
  const [modus, setModus] = useState<null | 'schnell' | 'vermisst'>(null);
  const [form] = Form.useForm<TierEingabe>();

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['einsatz-tiere', einsatzId] });
    qc.invalidateQueries({ queryKey: ['etb', einsatzId] });
  }
  const fehler = (e: unknown) => message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen');

  const anlegenMutation = useMutation({
    mutationFn: (v: TierEingabe) => legeTierAn(einsatzId, v),
    onSuccess: () => { invalidate(); setModus(null); form.resetFields(); },
    onError: fehler,
  });

  const [offenesTierId, setOffenesTierId] = useState<number | null>(null);
  const [bearbeiten, setBearbeiten] = useState(false);
  const [editForm] = Form.useForm<TierPatch & { halter_modus?: 'fk' | 'freitext' | 'keiner' }>();

  const detailQuery = useQuery({
    queryKey: ['einsatz-tier', einsatzId, offenesTierId],
    queryFn: () => ladeTier(einsatzId, offenesTierId!),
    enabled: offenesTierId != null,
  });

  function invalidateDetail() {
    invalidate();
    qc.invalidateQueries({ queryKey: ['einsatz-tier', einsatzId, offenesTierId] });
  }
  const editMutation = useMutation({
    mutationFn: (daten: TierPatch) => aktualisiereTier(einsatzId, offenesTierId!, daten),
    onSuccess: () => { invalidateDetail(); setBearbeiten(false); }, onError: fehler,
  });
  const statusMutation = useMutation({
    mutationFn: (v: { status: TierStatus }) => setzeTierStatus(einsatzId, offenesTierId!, { status: v.status }),
    onSuccess: invalidateDetail, onError: fehler,
  });
  const stornoMutation = useMutation({
    mutationFn: (tierId: number) => storniereTier(einsatzId, tierId),
    onSuccess: () => { invalidate(); setOffenesTierId(null); }, onError: fehler,
  });

  // Abschluss-Modal (Pflicht-Grund + optionales Ziel).
  const [abschlussOffen, setAbschlussOffen] = useState(false);
  const [abschlussForm] = Form.useForm<{ abschluss_grund: AbschlussGrund; abschluss_ziel?: string }>();
  const abschlussMutation = useMutation({
    mutationFn: (v: { abschluss_grund: AbschlussGrund; abschluss_ziel?: string }) =>
      setzeTierStatus(einsatzId, offenesTierId!, {
        status: 'abgeschlossen', abschluss_grund: v.abschluss_grund, abschluss_ziel: v.abschluss_ziel ?? null,
      }),
    onSuccess: () => { invalidateDetail(); setAbschlussOffen(false); abschlussForm.resetFields(); },
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

  function drawerInhalt(t: Tier) {
    return (
      <Space direction="vertical" style={{ width: '100%' }} size="large">
        <Space wrap>
          <Tag color={STATUS_META[t.status].color}>{STATUS_META[t.status].label}</Tag>
          <Tag>{SPEZIES_META[t.spezies]}</Tag>
          {t.storniert_at && <Tag color="default">storniert</Tag>}
        </Space>

        {darfSchreiben && !t.storniert_at && (
          <Space wrap>
            {naechsteStatus(t.status).map((s) =>
              s === 'abgeschlossen' ? (
                <Button key={s} size="small" onClick={() => setAbschlussOffen(true)}>Abschließen</Button>
              ) : (
                <Button key={s} size="small"
                  onClick={() => statusMutation.mutate({ status: s })}>
                  {s === 'vermisst' ? 'Als vermisst markieren' : s === 'aktiv' && t.status === 'vermisst' ? 'Aufgefunden' : `→ ${STATUS_META[s].label}`}
                </Button>
              ),
            )}
          </Space>
        )}

        {bearbeiten ? (
          <Form form={editForm} layout="vertical"
            onFinish={(daten) => {
              const modus = daten.halter_modus ?? 'keiner';
              const patch: TierPatch = {
                rasse_beschreibung: daten.rasse_beschreibung, rufname: daten.rufname,
                geschlecht: daten.geschlecht, alter_geschaetzt: daten.alter_geschaetzt,
                farbe_beschreibung: daten.farbe_beschreibung, kennzeichnung: daten.kennzeichnung,
                groesse_gewicht: daten.groesse_gewicht, antreff_ort: daten.antreff_ort, notiz: daten.notiz,
                // Halter-Toggle: immer beide Felder explizit senden (eines null).
                halter_person_id: modus === 'fk' ? daten.halter_person_id ?? null : null,
                halter_kontakt: modus === 'freitext' ? daten.halter_kontakt ?? null : null,
              };
              editMutation.mutate(patch);
            }}>
            <Form.Item label="Rufname" name="rufname"><Input /></Form.Item>
            <Form.Item label="Rasse / Beschreibung" name="rasse_beschreibung"><Input /></Form.Item>
            <Form.Item label="Geschlecht" name="geschlecht">
              <Select allowClear options={[
                { value: 'maennlich', label: 'männlich' }, { value: 'weiblich', label: 'weiblich' },
                { value: 'unbekannt', label: 'unbekannt' },
              ]} />
            </Form.Item>
            <Form.Item label="Geschätztes Alter (Jahre)" name="alter_geschaetzt"><InputNumber min={0} max={120} /></Form.Item>
            <Form.Item label="Farbe / Erscheinung" name="farbe_beschreibung"><Input /></Form.Item>
            <Form.Item label="Kennzeichnung (Chip/Tätowierung/Halsband)" name="kennzeichnung"><Input /></Form.Item>
            <Form.Item label="Größe / Gewicht" name="groesse_gewicht"><Input /></Form.Item>
            <Form.Item label="Antreffort" name="antreff_ort"><Input /></Form.Item>
            <Form.Item label="Halter" name="halter_modus">
              <Radio.Group options={[
                { value: 'keiner', label: 'unbekannt' },
                { value: 'fk', label: 'Person im Einsatz (R-Nr.)' },
                { value: 'freitext', label: 'Freitext (extern)' },
              ]} />
            </Form.Item>
            <Form.Item noStyle shouldUpdate={(p, c) => p.halter_modus !== c.halter_modus}>
              {() => {
                const m = editForm.getFieldValue('halter_modus');
                if (m === 'fk') return <Form.Item label="Halter-Person-ID" name="halter_person_id"><InputNumber min={1} style={{ width: 200 }} /></Form.Item>;
                if (m === 'freitext') return <Form.Item label="Halter-Kontakt (Name, Tel.)" name="halter_kontakt"><Input /></Form.Item>;
                return null;
              }}
            </Form.Item>
            <Form.Item label="Notiz" name="notiz"><Input.TextArea rows={2} /></Form.Item>
            <Space>
              <Button type="primary" htmlType="submit" loading={editMutation.isPending}>Speichern</Button>
              <Button onClick={() => setBearbeiten(false)}>Abbrechen</Button>
            </Space>
          </Form>
        ) : (
          <Descriptions column={1} size="small" bordered>
            <Descriptions.Item label="Rufname">{t.rufname ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="Rasse / Beschreibung">{t.rasse_beschreibung ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="Geschlecht">{t.geschlecht ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="Alter (geschätzt)">{t.alter_geschaetzt ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="Farbe / Erscheinung">{t.farbe_beschreibung ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="Kennzeichnung">{t.kennzeichnung ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="Größe / Gewicht">{t.groesse_gewicht ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="Antreffort">{t.antreff_ort ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="Halter">
              {/* Klick auf R-nnn führt in den (auditierten) Personen-Pfad. */}
              {t.halter_person_id != null ? (
                <Button type="link" style={{ padding: 0 }} onClick={() => navigate(`/einsaetze/${einsatzId}/personen`)}>
                  {halterAnzeige(t)}
                </Button>
              ) : halterAnzeige(t)}
            </Descriptions.Item>
            <Descriptions.Item label="Notiz">{t.notiz ?? '—'}</Descriptions.Item>
          </Descriptions>
        )}

        {t.status === 'abgeschlossen' && (
          <Descriptions column={1} size="small" title="Abschluss">
            <Descriptions.Item label="Grund">{t.abschluss_grund ? ABSCHLUSS_META[t.abschluss_grund] : '—'}</Descriptions.Item>
            <Descriptions.Item label="Ziel">{t.abschluss_ziel ?? '—'}</Descriptions.Item>
          </Descriptions>
        )}

        {darfSchreiben && !t.storniert_at && !bearbeiten && (
          <Space>
            <Button onClick={() => {
              setBearbeiten(true);
              editForm.setFieldsValue({
                rufname: t.rufname,
                rasse_beschreibung: t.rasse_beschreibung,
                geschlecht: t.geschlecht,
                alter_geschaetzt: t.alter_geschaetzt,
                farbe_beschreibung: t.farbe_beschreibung,
                kennzeichnung: t.kennzeichnung,
                groesse_gewicht: t.groesse_gewicht,
                antreff_ort: t.antreff_ort,
                notiz: t.notiz,
                halter_person_id: t.halter_person_id,
                halter_kontakt: t.halter_kontakt,
                halter_modus: t.halter_person_id != null ? 'fk' : t.halter_kontakt ? 'freitext' : 'keiner',
              });
            }}>Bearbeiten</Button>
            <Popconfirm title="Tier stornieren (Soft-Delete)?" onConfirm={() => stornoMutation.mutate(t.id)}>
              <Button danger>Stornieren</Button>
            </Popconfirm>
          </Space>
        )}
      </Space>
    );
  }

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
        <Alert style={{ marginBottom: 12 }} type="info" showIcon message="Einsatz ist abgeschlossen — nur Ansicht." />
      )}

      <Table
        rowKey="id"
        loading={tiereQuery.isLoading}
        dataSource={tiere}
        columns={spalten}
        pagination={false}
        locale={{ emptyText: 'Keine Tiere in dieser Sicht' }}
        onRow={(t) => ({ onClick: () => { setOffenesTierId(t.id); setBearbeiten(false); }, style: { cursor: 'pointer' } })}
      />

      <Modal
        open={modus !== null}
        title={modus === 'vermisst' ? 'Vermisst melden' : 'Schnellerfassung'}
        okText="Erfassen"
        confirmLoading={anlegenMutation.isPending}
        onOk={() => form.submit()}
        onCancel={() => { setModus(null); form.resetFields(); }}
        destroyOnClose
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

      <Drawer
        open={offenesTierId != null}
        width={520}
        title={detailQuery.data ? `Tier ${tierRegistrierAnzeige(detailQuery.data.registrier_nr)}` : 'Tier'}
        onClose={() => { setOffenesTierId(null); setBearbeiten(false); }}
      >
        {detailQuery.isLoading && <Spin />}
        {detailQuery.data && drawerInhalt(detailQuery.data)}
      </Drawer>

      <Modal
        open={abschlussOffen}
        title="Tier abschließen"
        okText="Abschließen"
        confirmLoading={abschlussMutation.isPending}
        onOk={() => abschlussForm.submit()}
        onCancel={() => { setAbschlussOffen(false); abschlussForm.resetFields(); }}
        destroyOnClose
      >
        <Form form={abschlussForm} layout="vertical" onFinish={abschlussMutation.mutate}>
          <Form.Item label="Abschlussgrund" name="abschluss_grund" rules={[{ required: true, message: 'Grund ist Pflicht' }]}>
            <Select options={(Object.keys(ABSCHLUSS_META) as AbschlussGrund[]).map((k) => ({ value: k, label: ABSCHLUSS_META[k] }))} />
          </Form.Item>
          <Form.Item label="Ziel (Freitext, z. B. Tierarzt Müller, R-Nr. des Halters)" name="abschluss_ziel"><Input /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
