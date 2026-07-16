import { Alert, App, Breadcrumb, Button, Descriptions, Form, Input, InputNumber, Modal, Popconfirm, Space, Spin, Tag, Typography } from 'antd';
import { Select } from '../components/Select';
import { useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ladeEinsatz } from '../api/einsaetze';
import { aktualisiereTier, ladeTier, setzeTierStatus, storniereTier, tierRegistrierAnzeige, type TierPatch } from '../api/einsatzTier';
import { ApiError } from '../api/client';
import { einsatzKeys } from '../api/queryKeys';
import { parseRouteId, personDetailPfad, tierePfad } from '../routing/deeplinks';
import type { AbschlussGrund, Spezies, Tier, TierStatus } from '../api/types';
import HalterPicker, { type HalterWert } from './HalterPicker';

const STATUS_META: Record<TierStatus, { label: string; color: string }> = {
  aktiv: { label: 'aktiv', color: 'green' },
  vermisst: { label: 'vermisst', color: 'orange' },
  abgeschlossen: { label: 'abgeschlossen', color: 'default' },
};

const SPEZIES_META: Record<Spezies, string> = {
  hund: 'Hund', katze: 'Katze', grosstier: 'Großtier', nutzgefluegel: 'Nutzgeflügel',
  kleintier: 'Kleintier', wildtier: 'Wildtier', sonstige: 'Sonstige',
};

const ABSCHLUSS_META: Record<AbschlussGrund, string> = {
  uebergabe_halter: 'Übergabe an Halter', uebergabe_tierarzt: 'Übergabe an Tierarzt',
  uebergabe_tierheim: 'Übergabe an Tierheim', verstorben: 'verstorben',
  freilauf: 'Freilauf', sonstiges: 'Sonstiges',
};

/** Erlaubte Folge-Status (Spiegel von darf_uebergehen im Backend). */
function naechsteStatus(aktuell: TierStatus): TierStatus[] {
  switch (aktuell) {
    case 'aktiv': return ['vermisst', 'abgeschlossen'];
    case 'vermisst': return ['aktiv', 'abgeschlossen'];
    case 'abgeschlossen': return ['aktiv', 'vermisst'];
  }
}

/** Halter-Kurzanzeige. */
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

export default function TiereDetailPage() {
  const { id, tierId: tierIdParam } = useParams();
  const einsatzId = Number(id);
  const tierId = Number(tierIdParam);
  const idGueltig = parseRouteId(tierIdParam) != null;
  const navigate = useNavigate();

  const qc = useQueryClient();
  const { message } = App.useApp();
  const [bearbeiten, setBearbeiten] = useState(false);
  const [editForm] = Form.useForm<TierPatch & { halter?: HalterWert }>();
  const [abschlussOffen, setAbschlussOffen] = useState(false);
  const [abschlussForm] = Form.useForm<{ abschluss_grund: AbschlussGrund; abschluss_ziel?: string }>();

  const fehler = (e: unknown) => message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen');

  function invalidate() {
    qc.invalidateQueries({ queryKey: einsatzKeys.tiere(einsatzId) });
    qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
  }
  function invalidateDetail() {
    invalidate();
    qc.invalidateQueries({ queryKey: einsatzKeys.tier(einsatzId, tierId) });
  }

  const einsatzQuery = useQuery({ queryKey: einsatzKeys.einsatz(einsatzId), queryFn: () => ladeEinsatz(einsatzId) });
  const detailQuery = useQuery({
    queryKey: einsatzKeys.tier(einsatzId, tierId),
    queryFn: () => ladeTier(einsatzId, tierId),
    enabled: idGueltig,
  });

  const editMutation = useMutation({
    mutationFn: (daten: TierPatch) => aktualisiereTier(einsatzId, tierId, daten),
    onSuccess: () => { invalidateDetail(); setBearbeiten(false); }, onError: fehler,
  });
  const statusMutation = useMutation({
    mutationFn: (v: { status: TierStatus }) => setzeTierStatus(einsatzId, tierId, { status: v.status }),
    onSuccess: invalidateDetail, onError: fehler,
  });
  const stornoMutation = useMutation({
    mutationFn: (tid: number) => storniereTier(einsatzId, tid),
    onSuccess: () => { invalidate(); navigate(tierePfad(einsatzId)); }, onError: fehler,
  });
  const abschlussMutation = useMutation({
    mutationFn: (v: { abschluss_grund: AbschlussGrund; abschluss_ziel?: string }) =>
      setzeTierStatus(einsatzId, tierId, {
        status: 'abgeschlossen', abschluss_grund: v.abschluss_grund, abschluss_ziel: v.abschluss_ziel ?? null,
      }),
    onSuccess: () => { invalidateDetail(); setAbschlussOffen(false); abschlussForm.resetFields(); },
    onError: fehler,
  });

  // NaN-/Bad-ID-Guard nach allen Hooks (Rules-of-Hooks): ungültige Route-ID → zurück auf die Liste.
  if (!idGueltig) {
    return <Navigate to={tierePfad(einsatzId)} replace />;
  }
  if (einsatzQuery.isLoading || detailQuery.isLoading) {
    return <div style={{ textAlign: 'center', paddingTop: 80 }}><Spin size="large" /></div>;
  }
  if (einsatzQuery.isError || !einsatzQuery.data) {
    return <Alert type="error" title="Einsatz nicht gefunden oder kein Zugriff" showIcon />;
  }
  const einsatz = einsatzQuery.data;
  const zurueck = tierePfad(einsatzId);

  if (detailQuery.isError) {
    return (
      <Alert
        type="error" showIcon
        title="Tier konnte nicht geladen werden"
        description={detailQuery.error instanceof ApiError ? detailQuery.error.message : undefined}
        action={<Button size="small" onClick={() => detailQuery.refetch()}>Erneut versuchen</Button>}
      />
    );
  }
  if (!detailQuery.data) {
    return <Alert type="error" title="Tier nicht gefunden" showIcon />;
  }
  const t = detailQuery.data;

  const darfSchreiben =
    einsatz.status === 'aktiv' &&
    (einsatz.meine_rolle === 'einsatzleitung' || einsatz.meine_rolle === 'fuehrungspersonal');

  // Eine Detail-Zelle: im Edit-Modus ein noStyle-Form.Item mit Input, sonst die Read-Anzeige.
  // So bleibt beim Bearbeiten dieselbe Descriptions-Tabelle stehen — nur die Werte werden zu Feldern,
  // statt die ganze Ansicht gegen ein separates Formular zu tauschen.
  const zelle = (name: string, input: React.ReactNode, anzeige: React.ReactNode) =>
    bearbeiten ? <Form.Item name={name} noStyle>{input}</Form.Item> : anzeige;

  const detailAnsicht = (
    <Descriptions column={1} size="small" bordered>
      <Descriptions.Item label="Rufname">{zelle('rufname', <Input placeholder="Rufname" />, t.rufname ?? '—')}</Descriptions.Item>
      <Descriptions.Item label="Rasse / Beschreibung">{zelle('rasse_beschreibung', <Input />, t.rasse_beschreibung ?? '—')}</Descriptions.Item>
      <Descriptions.Item label="Geschlecht">
        {zelle('geschlecht',
          <Select allowClear style={{ minWidth: 160 }} placeholder="—" options={[
            { value: 'maennlich', label: 'männlich' }, { value: 'weiblich', label: 'weiblich' },
            { value: 'unbekannt', label: 'unbekannt' },
          ]} />,
          t.geschlecht ?? '—')}
      </Descriptions.Item>
      <Descriptions.Item label="Alter in Jahren (geschätzt)">{zelle('alter_geschaetzt', <InputNumber min={0} max={120} />, t.alter_geschaetzt ?? '—')}</Descriptions.Item>
      <Descriptions.Item label="Farbe / Erscheinung">{zelle('farbe_beschreibung', <Input />, t.farbe_beschreibung ?? '—')}</Descriptions.Item>
      <Descriptions.Item label="Kennzeichnung">{zelle('kennzeichnung', <Input placeholder="Chip / Tätowierung / Halsband" />, t.kennzeichnung ?? '—')}</Descriptions.Item>
      <Descriptions.Item label="Größe / Gewicht">{zelle('groesse_gewicht', <Input />, t.groesse_gewicht ?? '—')}</Descriptions.Item>
      <Descriptions.Item label="Antreffort">{zelle('antreff_ort', <Input />, t.antreff_ort ?? '—')}</Descriptions.Item>
      <Descriptions.Item label="Halter">
        {zelle('halter', <HalterPicker einsatzId={einsatzId} />,
          // Klick auf R-nnn führt direkt zur (auditierten) Personen-Detailseite des Halters.
          t.halter_person_id != null ? (
            <Button type="link" style={{ padding: 0 }} onClick={() => navigate(personDetailPfad(einsatzId, t.halter_person_id!))}>
              {halterAnzeige(t)}
            </Button>
          ) : halterAnzeige(t))}
      </Descriptions.Item>
      <Descriptions.Item label="Notiz">{zelle('notiz', <Input.TextArea rows={2} />, t.notiz ?? '—')}</Descriptions.Item>
    </Descriptions>
  );

  return (
    <div>
      <Breadcrumb
        style={{ marginBottom: 12 }}
        items={[
          { title: <Link to="/einsaetze">Einsätze</Link> },
          { title: einsatz.bezeichnung },
          { title: <Link to={zurueck}>Tiere</Link> },
          { title: tierRegistrierAnzeige(t.registrier_nr) },
        ]}
      />
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }} align="start">
        <Space wrap>
          <Typography.Title level={3} style={{ margin: 0 }}>
            Tier {tierRegistrierAnzeige(t.registrier_nr)}
          </Typography.Title>
          <Tag color={STATUS_META[t.status].color}>{STATUS_META[t.status].label}</Tag>
          <Tag>{SPEZIES_META[t.spezies]}</Tag>
          {t.storniert_at && <Tag color="default">storniert</Tag>}
        </Space>
        <Space>
          {darfSchreiben && !t.storniert_at && !bearbeiten && (
            <Space wrap>
              {naechsteStatus(t.status).map((s) =>
                s === 'abgeschlossen' ? (
                  <Button key={s} size="small" onClick={() => setAbschlussOffen(true)}>Abschließen</Button>
                ) : (
                  <Button key={s} size="small" onClick={() => statusMutation.mutate({ status: s })}>
                    {s === 'vermisst' ? 'Als vermisst markieren' : s === 'aktiv' && t.status === 'vermisst' ? 'Aufgefunden' : `→ ${STATUS_META[s].label}`}
                  </Button>
                ),
              )}
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
                  halter: t.halter_person_id != null
                    ? { typ: 'person', refId: t.halter_person_id, label: t.halter_registrier_nr != null ? `R-${String(t.halter_registrier_nr).padStart(3, '0')}` : 'Halter' }
                    : t.halter_kontakt ? { typ: 'extern', kontakt: t.halter_kontakt } : null,
                });
              }}>Bearbeiten</Button>
              <Popconfirm title="Tier stornieren (Soft-Delete)?" onConfirm={() => stornoMutation.mutate(t.id)}>
                <Button danger>Stornieren</Button>
              </Popconfirm>
            </Space>
          )}
          <Button onClick={() => navigate(zurueck)}>Zurück zur Liste</Button>
        </Space>
      </Space>

      <Space orientation="vertical" style={{ width: '100%' }} size="large">
        {bearbeiten ? (
          <Form form={editForm}
            onFinish={(daten) => {
              const h = daten.halter ?? null;
              const patch: TierPatch = {
                rasse_beschreibung: daten.rasse_beschreibung, rufname: daten.rufname,
                geschlecht: daten.geschlecht, alter_geschaetzt: daten.alter_geschaetzt,
                farbe_beschreibung: daten.farbe_beschreibung, kennzeichnung: daten.kennzeichnung,
                groesse_gewicht: daten.groesse_gewicht, antreff_ort: daten.antreff_ort, notiz: daten.notiz,
                // Halter XOR: immer beide Felder explizit senden (das nicht gewählte ist null).
                halter_person_id: h?.typ === 'person' ? h.refId : null,
                halter_kontakt: h?.typ === 'extern' ? h.kontakt : null,
              };
              editMutation.mutate(patch);
            }}>
            {detailAnsicht}
            <Space style={{ marginTop: 16 }}>
              <Button type="primary" htmlType="submit" loading={editMutation.isPending}>Speichern</Button>
              <Button onClick={() => setBearbeiten(false)}>Abbrechen</Button>
            </Space>
          </Form>
        ) : detailAnsicht}

        {t.status === 'abgeschlossen' && (
          <Descriptions column={1} size="small" title="Abschluss">
            <Descriptions.Item label="Grund">{t.abschluss_grund ? ABSCHLUSS_META[t.abschluss_grund] : '—'}</Descriptions.Item>
            <Descriptions.Item label="Ziel">{t.abschluss_ziel ?? '—'}</Descriptions.Item>
          </Descriptions>
        )}
      </Space>

      <Modal
        open={abschlussOffen}
        title="Tier abschließen"
        okText="Abschließen"
        confirmLoading={abschlussMutation.isPending}
        onOk={() => abschlussForm.submit()}
        onCancel={() => { setAbschlussOffen(false); abschlussForm.resetFields(); }}
        destroyOnHidden
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
