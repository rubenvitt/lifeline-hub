import { Alert, App, Breadcrumb, Button, Descriptions, Form, Input, Modal, Popconfirm, Space, Spin, Tag, Typography } from 'antd';
import { Select } from '../components/Select';
import { useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ladeEinsatz } from '../api/einsaetze';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { useAuth } from '../auth/AuthContext';
import {
  aktualisiereSchaden,
  ladeSchaden,
  schadenRegistrierAnzeige,
  schliesseSchadenAb,
  storniereSchaden,
  uebergebeSchaden,
  type SchadenPatch,
} from '../api/einsatzSchaden';
import { ApiError, istKonflikt } from '../api/client';
import { einsatzKeys } from '../api/queryKeys';
import { parseRouteId, schaedenPfad } from '../routing/deeplinks';
import type { Ausmass, SchadenTyp } from '../api/types';
import GeschaedigtPicker, { type GeschaedigtWert } from './schaeden/GeschaedigtPicker';
import {
  ABSCHLUSS_GRUENDE,
  ABSCHLUSS_LABEL,
  AUSMASS_META,
  STATUS_META,
  TYP_LABEL,
  geschaedigtAnzeige,
  geschaedigtAusSchaden,
  geschaedigtFelder,
} from './schaeden/schadenHelfer';

const TYP_OPTIONS = (Object.keys(TYP_LABEL) as SchadenTyp[]).map((t) => ({ value: t, label: TYP_LABEL[t] }));
const AUSMASS_OPTIONS = (Object.keys(AUSMASS_META) as Ausmass[]).map((a) => ({ value: a, label: AUSMASS_META[a].label }));

type EditWerte = SchadenPatch & { geschaedigt?: GeschaedigtWert };

export default function SchaedenDetailPage() {
  const { id, schadenId: schadenIdParam } = useParams();
  const einsatzId = Number(id);
  const { benutzer } = useAuth();
  const schadenId = Number(schadenIdParam);
  const idGueltig = parseRouteId(schadenIdParam) != null;
  const navigate = useNavigate();

  const qc = useQueryClient();
  const { message, modal } = App.useApp();
  const [bearbeiten, setBearbeiten] = useState(false);
  const [editForm] = Form.useForm<EditWerte>();
  const [uebergebenOffen, setUebergebenOffen] = useState(false);
  const [abschlussOffen, setAbschlussOffen] = useState(false);
  const [uebergebForm] = Form.useForm<{ uebergeben_an: string }>();
  const [abschlussForm] = Form.useForm<{ abschluss_grund: string; notiz?: string }>();

  const fehler = (e: unknown) => message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen');

  function invalidate() {
    qc.invalidateQueries({ queryKey: einsatzKeys.schaeden(einsatzId) });
    qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
  }
  function invalidateDetail() {
    invalidate();
    qc.invalidateQueries({ queryKey: einsatzKeys.schaden(einsatzId, schadenId) });
  }

  const einsatzQuery = useQuery({ queryKey: einsatzKeys.einsatz(einsatzId), queryFn: () => ladeEinsatz(einsatzId) });
  const detailQuery = useQuery({
    queryKey: einsatzKeys.schaden(einsatzId, schadenId),
    queryFn: () => ladeSchaden(einsatzId, schadenId),
    enabled: idGueltig,
  });

  // Optimistisches Lock (LFH-300/F10): `basis` trägt den beim Laden gelesenen geaendert_at-Stand;
  // ein 409 öffnet den Konfliktdialog (neu laden vs. überschreiben), statt still zu überschreiben.
  const editMutation = useMutation({
    mutationFn: (v: { daten: SchadenPatch; basis?: string; overwrite?: boolean }) =>
      aktualisiereSchaden(einsatzId, schadenId, v.daten, v.overwrite ? undefined : v.basis),
    onSuccess: () => { invalidateDetail(); setBearbeiten(false); },
    onError: (e, v) => {
      // Nur der ERSTE 409 (Save MIT Baseline) ist der Sperrkonflikt. Anders als beim
      // Person-PATCH (Referenz LFH-241) kennt die Schaden-Route einen ZWEITEN 409: den
      // Storno-Guard, der vor der CAS greift und den `overwrite` nicht umgehen kann.
      // Ein 409 auf den Overwrite muss deshalb die echte Servermeldung zeigen, statt
      // denselben Dialog erneut zu öffnen — sonst wäre „Überschreiben" ein toter Button.
      if (istKonflikt(e) && !v.overwrite) {
        modal.confirm({
          title: 'Zwischenzeitlich geändert',
          content:
            'Dieser Schaden wurde seit dem Öffnen von jemand anderem gespeichert. „Neu laden" verwirft deine Änderungen; „Überschreiben" speichert deine Werte über die des anderen.',
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
  const uebergebMutation = useMutation({
    mutationFn: (an: string) => uebergebeSchaden(einsatzId, schadenId, an),
    onSuccess: () => { invalidateDetail(); setUebergebenOffen(false); uebergebForm.resetFields(); }, onError: fehler,
  });
  const abschlussMutation = useMutation({
    mutationFn: (v: { abschluss_grund: string; notiz?: string }) =>
      schliesseSchadenAb(einsatzId, schadenId, v.abschluss_grund, v.notiz),
    onSuccess: () => { invalidateDetail(); setAbschlussOffen(false); abschlussForm.resetFields(); }, onError: fehler,
  });
  const stornoMutation = useMutation({
    mutationFn: () => storniereSchaden(einsatzId, schadenId),
    onSuccess: () => { invalidate(); navigate(schaedenPfad(einsatzId)); }, onError: fehler,
  });

  // NaN-/Bad-ID-Guard nach allen Hooks (Rules-of-Hooks): ungültige Route-ID → zurück auf die Liste.
  if (!idGueltig) {
    return <Navigate to={schaedenPfad(einsatzId)} replace />;
  }
  if (einsatzQuery.isLoading || detailQuery.isLoading) {
    return <div style={{ textAlign: 'center', paddingTop: 80 }}><Spin size="large" /></div>;
  }
  if (einsatzQuery.isError || !einsatzQuery.data) {
    return <Alert type="error" title="Einsatz nicht gefunden oder kein Zugriff" showIcon />;
  }
  const einsatz = einsatzQuery.data;
  const zurueck = schaedenPfad(einsatzId);

  if (detailQuery.isError) {
    return (
      <Alert
        type="error" showIcon
        title="Schaden konnte nicht geladen werden"
        description={detailQuery.error instanceof ApiError ? detailQuery.error.message : undefined}
        action={<Button size="small" onClick={() => detailQuery.refetch()}>Erneut versuchen</Button>}
      />
    );
  }
  if (!detailQuery.data) {
    return <Alert type="error" title="Schaden nicht gefunden" showIcon />;
  }
  const s = detailQuery.data;
  const orgId = einsatz.org_id ?? 0;

  const darfSchreiben = darfImEinsatzSchreiben(einsatz, benutzer);

  // Eine Detail-Zelle: im Edit-Modus ein noStyle-Form.Item, sonst die Read-Anzeige — so bleibt
  // dieselbe Descriptions-Tabelle stehen, statt die Ansicht gegen ein separates Formular zu tauschen.
  const zelle = (name: string, input: React.ReactNode, anzeige: React.ReactNode, rules?: object[]) =>
    bearbeiten ? <Form.Item name={name} noStyle rules={rules}>{input}</Form.Item> : anzeige;

  const detailAnsicht = (
    <Descriptions column={1} size="small" bordered>
      <Descriptions.Item label="Typ">
        {zelle('typ', <Select style={{ minWidth: 200 }} options={TYP_OPTIONS} />, <Tag>{TYP_LABEL[s.typ]}</Tag>)}
      </Descriptions.Item>
      <Descriptions.Item label="Ausmaß">
        {zelle('ausmass', <Select style={{ minWidth: 160 }} options={AUSMASS_OPTIONS} />,
          <Tag color={AUSMASS_META[s.ausmass].color}>{AUSMASS_META[s.ausmass].label}</Tag>)}
      </Descriptions.Item>
      <Descriptions.Item label="Ort">
        {zelle('ort', <Input placeholder="z. B. Hauptstr. 17 oder L 235 km 12,5" />, s.ort,
          [{ required: true, message: 'Ort ist Pflicht' }])}
      </Descriptions.Item>
      <Descriptions.Item label="Beschreibung">
        {zelle('beschreibung', <Input.TextArea rows={2} />, s.beschreibung || '—')}
      </Descriptions.Item>
      <Descriptions.Item label="Geschädigt">
        {zelle('geschaedigt',
          <GeschaedigtPicker einsatzId={einsatzId} orgName={einsatz.org_name ?? 'Eigene Organisation'} />,
          geschaedigtAnzeige(s, einsatzId))}
      </Descriptions.Item>
      {s.status !== 'offen' && (
        <Descriptions.Item label="Übergeben an">{s.uebergeben_an || '—'}</Descriptions.Item>
      )}
      {s.status === 'abgeschlossen' && (
        <Descriptions.Item label="Abschlussgrund">
          {s.abschluss_grund ? ABSCHLUSS_LABEL[s.abschluss_grund] : '—'}
        </Descriptions.Item>
      )}
    </Descriptions>
  );

  return (
    <div>
      <Breadcrumb
        style={{ marginBottom: 12 }}
        items={[
          { title: <Link to="/einsaetze">Einsätze</Link> },
          { title: einsatz.bezeichnung },
          { title: <Link to={zurueck}>Schäden</Link> },
          { title: schadenRegistrierAnzeige(s.registrier_nr) },
        ]}
      />
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }} align="start">
        <Space wrap>
          <Typography.Title level={3} style={{ margin: 0 }}>
            Schaden {schadenRegistrierAnzeige(s.registrier_nr)}
          </Typography.Title>
          <Tag color={STATUS_META[s.status].color}>{STATUS_META[s.status].label}</Tag>
          {s.storniert_at && <Tag color="default">storniert</Tag>}
        </Space>
        <Space>
          {darfSchreiben && !s.storniert_at && !bearbeiten && (
            <Space wrap>
              <Button size="small" disabled={s.status !== 'offen'} onClick={() => setUebergebenOffen(true)}>
                Übergeben
              </Button>
              <Button size="small" disabled={s.status === 'abgeschlossen'} onClick={() => setAbschlussOffen(true)}>
                Abschließen
              </Button>
              <Button onClick={() => {
                setBearbeiten(true);
                editForm.setFieldsValue({
                  typ: s.typ, ausmass: s.ausmass, ort: s.ort, beschreibung: s.beschreibung,
                  geschaedigt: geschaedigtAusSchaden(s),
                });
              }}>Bearbeiten</Button>
              <Popconfirm title="Schaden stornieren?" onConfirm={() => stornoMutation.mutate()} okText="Stornieren">
                <Button danger>Stornieren</Button>
              </Popconfirm>
            </Space>
          )}
          <Button onClick={() => navigate(zurueck)}>Zurück zur Liste</Button>
        </Space>
      </Space>

      {bearbeiten ? (
        <Form form={editForm}
          onFinish={(daten) => {
            const patch: SchadenPatch = {
              typ: daten.typ, ausmass: daten.ausmass, ort: daten.ort, beschreibung: daten.beschreibung,
              // Geschädigt XOR: immer alle vier Felder explizit senden (das nicht gewählte ist null).
              ...geschaedigtFelder(daten.geschaedigt ?? null, orgId),
            };
            editMutation.mutate({ daten: patch, basis: s.geaendert_at });
          }}>
          {detailAnsicht}
          <Space style={{ marginTop: 16 }}>
            <Button type="primary" htmlType="submit" loading={editMutation.isPending}>Speichern</Button>
            <Button onClick={() => setBearbeiten(false)}>Abbrechen</Button>
          </Space>
        </Form>
      ) : detailAnsicht}

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
          <Form.Item label="Übergeben an" name="uebergeben_an" rules={[{ required: true, message: 'Adressat ist Pflicht' }]}>
            <Input placeholder="z. B. Stadtwerke, Bauhof, Umweltamt" />
          </Form.Item>
        </Form>
      </Modal>

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
          <Form.Item label="Abschlussgrund" name="abschluss_grund" rules={[{ required: true, message: 'Grund ist Pflicht' }]}>
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
