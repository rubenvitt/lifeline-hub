import {
  Alert, App, AutoComplete, Breadcrumb, Button, DatePicker, Descriptions,
  Form, Input, InputNumber, Select, Space, Spin, Tag, Typography,
} from 'antd';
import KoordinatenAnzeige from '../anzeige/KoordinatenAnzeige';
import KoordinatenEingabe from '../anzeige/KoordinatenEingabe';
import type { LatLon } from '../anzeige/koordinaten';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import dayjs, { type Dayjs } from 'dayjs';
import { aktualisiereEinsatz, ladeEinsatz, ladeMitglieder, type KopfdatenUpdate } from '../api/einsaetze';
import { listeStichwortVorschlaege } from '../api/stichwortVorschlaege';
import { einsatzKeys } from '../api/queryKeys';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import type { Einsatzart } from '../api/types';
import MitgliederAbschnitt from './MitgliederAbschnitt';

const EINSATZART_LABELS: Record<Einsatzart, string> = {
  realeinsatz: 'Realeinsatz',
  uebung: 'Übung',
  sanitaetsdienst: 'Sanitätsdienst',
  bereitstellung: 'Bereitstellung',
};

/** Trimmt einen Formularwert; leer → null (wird serverseitig zu NULL). */
function leerZuNull(wert: string | undefined): string | null {
  const t = wert?.trim();
  return t ? t : null;
}

/** Werte des Bearbeiten-Formulars (begonnen_at als Dayjs aus dem DatePicker). */
interface FormWerte {
  bezeichnung: string;
  stichwort?: string;
  einsatzart: Einsatzart;
  einsatznummer_intern?: string;
  leitstellen_nr?: string;
  einsatzort?: string;
  einsatzort_koord?: LatLon | null;
  meldende_stelle?: string;
  sachverhalt?: string;
  anzahl_betroffene_initial?: number;
  begonnen_at: Dayjs;
}

export default function EinsatzdatenPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { benutzer } = useAuth();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [bearbeiten, setBearbeiten] = useState(false);
  const [form] = Form.useForm<FormWerte>();

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const mitgliederQuery = useQuery({
    queryKey: einsatzKeys.mitglieder(einsatzId),
    queryFn: () => ladeMitglieder(einsatzId),
  });
  const vorschlaegeQuery = useQuery({
    queryKey: ['stichwort-vorschlaege'],
    queryFn: listeStichwortVorschlaege,
  });

  const speichernMutation = useMutation({
    mutationFn: (felder: KopfdatenUpdate) => aktualisiereEinsatz(einsatzId, felder),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: einsatzKeys.einsatz(einsatzId) });
      qc.invalidateQueries({ queryKey: ['einsaetze'] });
      setBearbeiten(false);
      message.success('Einsatzdaten gespeichert');
    },
    onError: (e) =>
      message.error(e instanceof ApiError ? e.message : 'Speichern fehlgeschlagen'),
  });

  if (einsatzQuery.isLoading) {
    return (
      <div style={{ textAlign: 'center', paddingTop: 80 }}>
        <Spin size="large" />
      </div>
    );
  }
  if (einsatzQuery.isError || !einsatzQuery.data) {
    return <Alert type="error" title="Einsatz nicht gefunden oder kein Zugriff" showIcon />;
  }
  const einsatz = einsatzQuery.data;

  const istAdmin = benutzer?.system_rolle === 'admin';
  const darfBearbeiten =
    einsatz.status === 'aktiv' &&
    (einsatz.meine_rolle === 'einsatzleitung' ||
      einsatz.meine_rolle === 'fuehrungspersonal' ||
      istAdmin);

  const leitung = (mitgliederQuery.data ?? [])
    .filter((m) => m.einsatz_rolle === 'einsatzleitung')
    .map((m) => m.anzeigename)
    .join(', ');

  const darfVerwaltenMitglieder =
    einsatz.meine_rolle === 'einsatzleitung' && einsatz.status === 'aktiv';

  const stichwortOptionen = (vorschlaegeQuery.data ?? []).map((v) => ({ value: v.text }));

  function bearbeitenStarten() {
    form.setFieldsValue({
      bezeichnung: einsatz.bezeichnung,
      stichwort: einsatz.stichwort ?? undefined,
      einsatzart: einsatz.einsatzart,
      einsatznummer_intern: einsatz.einsatznummer_intern ?? undefined,
      leitstellen_nr: einsatz.leitstellen_nr ?? undefined,
      einsatzort: einsatz.einsatzort ?? undefined,
      einsatzort_koord:
        einsatz.einsatzort_lat != null && einsatz.einsatzort_lon != null
          ? { lat: einsatz.einsatzort_lat, lon: einsatz.einsatzort_lon }
          : null,
      meldende_stelle: einsatz.meldende_stelle ?? undefined,
      sachverhalt: einsatz.sachverhalt ?? undefined,
      anzahl_betroffene_initial: einsatz.anzahl_betroffene_initial ?? undefined,
      begonnen_at: dayjs(einsatz.begonnen_at),
    });
    setBearbeiten(true);
  }

  function speichern(werte: FormWerte) {
    const felder: KopfdatenUpdate = {
      bezeichnung: werte.bezeichnung.trim(),
      stichwort: leerZuNull(werte.stichwort),
      einsatzart: werte.einsatzart,
      einsatznummer_intern: leerZuNull(werte.einsatznummer_intern),
      leitstellen_nr: leerZuNull(werte.leitstellen_nr),
      einsatzort: leerZuNull(werte.einsatzort),
      einsatzort_lat: werte.einsatzort_koord?.lat ?? null,
      einsatzort_lon: werte.einsatzort_koord?.lon ?? null,
      meldende_stelle: leerZuNull(werte.meldende_stelle),
      sachverhalt: leerZuNull(werte.sachverhalt),
      anzahl_betroffene_initial: werte.anzahl_betroffene_initial ?? null,
      begonnen_at: werte.begonnen_at.format('YYYY-MM-DD HH:mm:ss'),
    };
    speichernMutation.mutate(felder);
  }

  return (
    <div>
      <Breadcrumb
        style={{ marginBottom: 12 }}
        items={[{ title: <Link to="/einsaetze">Einsätze</Link> }, { title: einsatz.bezeichnung }]}
      />
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }}>
        <Space>
          <Typography.Title level={3} style={{ margin: 0 }}>
            {einsatz.bezeichnung}
          </Typography.Title>
          <Tag color={einsatz.status === 'aktiv' ? 'green' : 'default'}>{einsatz.status}</Tag>
        </Space>
        {!bearbeiten && darfBearbeiten && (
          <Button type="primary" onClick={bearbeitenStarten}>
            Bearbeiten
          </Button>
        )}
      </Space>

      {bearbeiten ? (
        <Form<FormWerte> form={form} layout="vertical" onFinish={speichern}>
          <Form.Item
            label="Bezeichnung"
            name="bezeichnung"
            rules={[{ required: true, whitespace: true, message: 'Bezeichnung darf nicht leer sein' }]}
          >
            <Input />
          </Form.Item>
          <Form.Item label="Einsatzstichwort" name="stichwort">
            <AutoComplete options={stichwortOptionen} allowClear placeholder="z. B. H1, MANV …" />
          </Form.Item>
          <Form.Item label="Einsatzart" name="einsatzart" rules={[{ required: true }]}>
            <Select
              options={(Object.keys(EINSATZART_LABELS) as Einsatzart[]).map((k) => ({
                value: k,
                label: EINSATZART_LABELS[k],
              }))}
            />
          </Form.Item>
          <Form.Item label="Einsatznummer (intern)" name="einsatznummer_intern">
            <Input />
          </Form.Item>
          <Form.Item label="Leitstellen-Nr." name="leitstellen_nr">
            <Input />
          </Form.Item>
          <Form.Item label="Alarmzeit" name="begonnen_at" rules={[{ required: true }]}>
            <DatePicker showTime format="YYYY-MM-DD HH:mm:ss" style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="Einsatzort (Adresse)" name="einsatzort">
            <Input />
          </Form.Item>
          <Form.Item label="Koordinate" name="einsatzort_koord">
            <KoordinatenEingabe einsatzId={einsatzId} exclude={`einsatzort:${einsatzId}`} />
          </Form.Item>
          <Form.Item label="Meldende/anfordernde Stelle" name="meldende_stelle">
            <Input />
          </Form.Item>
          <Form.Item label="Sachverhalt / Meldebild" name="sachverhalt">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item label="Anzahl Betroffene (initial)" name="anzahl_betroffene_initial">
            <InputNumber min={0} style={{ width: 180 }} />
          </Form.Item>
          <Space>
            <Button type="primary" htmlType="submit" loading={speichernMutation.isPending}>
              Speichern
            </Button>
            <Button onClick={() => setBearbeiten(false)}>Abbrechen</Button>
          </Space>
        </Form>
      ) : (
        <Descriptions bordered column={1} size="middle">
          <Descriptions.Item label="Einsatzstichwort">{einsatz.stichwort ?? '—'}</Descriptions.Item>
          <Descriptions.Item label="Einsatzart">
            {EINSATZART_LABELS[einsatz.einsatzart]}
          </Descriptions.Item>
          <Descriptions.Item label="Einsatznummer (intern)">
            {einsatz.einsatznummer_intern ?? '—'}
          </Descriptions.Item>
          <Descriptions.Item label="Leitstellen-Nr.">
            {einsatz.leitstellen_nr ?? '—'}
          </Descriptions.Item>
          <Descriptions.Item label="Einsatzleitung">{leitung || '—'}</Descriptions.Item>
          <Descriptions.Item label="Alarmzeit">{einsatz.begonnen_at}</Descriptions.Item>
          <Descriptions.Item label="Angelegt am (techn.)">{einsatz.angelegt_at}</Descriptions.Item>
          <Descriptions.Item label="Einsatzort">{einsatz.einsatzort ?? '—'}</Descriptions.Item>
          <Descriptions.Item label="Koordinate">
            {einsatz.einsatzort_lat != null && einsatz.einsatzort_lon != null
              ? <KoordinatenAnzeige lat={einsatz.einsatzort_lat} lon={einsatz.einsatzort_lon} einsatzId={einsatzId} exclude={`einsatzort:${einsatzId}`} />
              : '—'}
          </Descriptions.Item>
          <Descriptions.Item label="Meldende Stelle">
            {einsatz.meldende_stelle ?? '—'}
          </Descriptions.Item>
          <Descriptions.Item label="Sachverhalt / Meldebild">
            {einsatz.sachverhalt ?? '—'}
          </Descriptions.Item>
          <Descriptions.Item label="Anzahl Betroffene (initial)">
            {einsatz.anzahl_betroffene_initial ?? '—'}
          </Descriptions.Item>
        </Descriptions>
      )}

      <MitgliederAbschnitt einsatzId={einsatzId} darfVerwalten={darfVerwaltenMitglieder} />
    </div>
  );
}
