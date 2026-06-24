import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { schadenDetailPfad } from '../routing/deeplinks';
import {
  App,
  Button,
  Form,
  Input,
  Modal,
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
  legeSchadenAn,
  listeSchaeden,
  schadenRegistrierAnzeige,
  type SchadenEingabe,
} from '../api/einsatzSchaden';
import type { Ausmass, Schaden, SchadenStatus, SchadenTyp } from '../api/types';
import { useSchaedenStream } from '../etb/useSchaedenStream';
import GeschaedigtPicker, { type GeschaedigtWert } from './schaeden/GeschaedigtPicker';
import { AUSMASS_META, STATUS_META, TYP_LABEL, geschaedigtAnzeige, geschaedigtFelder } from './schaeden/schadenHelfer';

type Sicht = 'offen' | 'uebergeben' | 'abgeschlossen' | 'alle';
const SICHTEN: { key: Sicht; label: string }[] = [
  { key: 'offen', label: 'Offen' },
  { key: 'uebergeben', label: 'Übergeben' },
  { key: 'abgeschlossen', label: 'Abgeschlossen' },
  { key: 'alle', label: 'Alle' },
];

export default function SchaedenPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { message } = App.useApp();
  const qc = useQueryClient();

  const [sicht, setSicht] = useState<Sicht>('offen');
  const [typFilter, setTypFilter] = useState<SchadenTyp | undefined>(undefined);
  const [ausmassFilter, setAusmassFilter] = useState<Ausmass | undefined>(undefined);
  const [suche, setSuche] = useState('');

  const [erfassenOffen, setErfassenOffen] = useState(false);
  const [erfassForm] = Form.useForm<SchadenEingabe>();
  // Geschädigt ist ein strukturierter Wert → lokaler State (kein Form.Item).
  const [erfassGeschaedigt, setErfassGeschaedigt] = useState<GeschaedigtWert>(null);

  useSchaedenStream(einsatzId);

  const einsatzQuery = useQuery({ queryKey: ['einsatz', einsatzId], queryFn: () => ladeEinsatz(einsatzId) });
  const schaedenQuery = useQuery({
    queryKey: ['einsatz-schaeden', einsatzId],
    queryFn: () => listeSchaeden(einsatzId),
  });

  const einsatz = einsatzQuery.data;
  const darfSchreiben =
    einsatz?.status === 'aktiv' &&
    (einsatz?.meine_rolle === 'einsatzleitung' || einsatz?.meine_rolle === 'fuehrungspersonal');

  // Schnellaktion: ?neu=1 öffnet die Erfassung (Command-Palette, LFH-11).
  // Warten bis der Einsatz geladen ist; Param immer löschen, aber Modal nur bei Schreibrecht öffnen.
  useEffect(() => {
    if (searchParams.get('neu') !== '1') return;
    if (einsatzQuery.isLoading) return;
    if (darfSchreiben) setErfassenOffen(true);
    searchParams.delete('neu');
    setSearchParams(searchParams, { replace: true });
  }, [searchParams, setSearchParams, einsatzQuery.isLoading, darfSchreiben]);

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['einsatz-schaeden', einsatzId] });
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
    { title: 'Geschädigt', key: 'geschaedigt', render: (_, row) => geschaedigtAnzeige(row, einsatzId) },
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
          onClick: () => navigate(schadenDetailPfad(einsatzId, row.id)),
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
    </div>
  );
}
