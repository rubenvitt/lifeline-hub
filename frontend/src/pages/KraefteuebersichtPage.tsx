import { Alert, App as AntApp, Breadcrumb, Button, Card, Input, Select, Space, Spin, Statistic, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { Link, useNavigate, useParams } from 'react-router-dom';
import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ladeEinsatz } from '../api/einsaetze';
import { listeEinheiten } from '../api/einheiten';
import { listeEinsatzPersonal } from '../api/einsatzPersonal';
import { listeEinsatzFahrzeuge } from '../api/einsatzFahrzeuge';
import { listeEinsatzMaterial } from '../api/einsatzMaterial';
import { listeAbschnitte } from '../api/einsatzabschnitte';
import { useEinsatzLiveStream } from '../etb/useEinsatzLiveStream';
import {
  baueKraeftebild,
  filtereKraefte,
  rendereMeldebildMarkdown,
  type FilterWerte,
  type MeldebildZeile,
  type Rohdaten,
  type StaerkeSumme,
  type StatusVerteilung,
} from '../kraefte/kraeftebild';
import { legeLageberichtAn, aktualisiereLagebericht } from '../api/lageberichte';
import type { MaterialStatus, StatusKategorie } from '../api/types';
import './kraefteuebersichtPrint.css';

export function staerkeText(s: StaerkeSumme): string {
  return `${s.fuehrer}/${s.unterfuehrer}/${s.mannschaft}/${s.gesamt}`;
}

const KAT_FARBE: Record<StatusKategorie, string> = { verfuegbar: 'green', gebunden: 'gold', nicht_verfuegbar: 'red' };

const MAT_STATUS_ANZEIGE: Array<{ key: MaterialStatus; label: string; farbe?: string }> = [
  { key: 'einsatzbereit', label: 'Mtl. einsatzbereit', farbe: '#52c41a' },
  { key: 'im_einsatz', label: 'Mtl. im Einsatz', farbe: '#faad14' },
  { key: 'defekt', label: 'Mtl. defekt', farbe: '#ff4d4f' },
  { key: 'verbraucht', label: 'Mtl. verbraucht' },
  { key: 'desinfektion_noetig', label: 'Mtl. Desinfektion', farbe: '#faad14' },
];

// Schlichter, umbruchsicherer Achsen-Trenner (Flex-Kind statt inline-block Divider).
const achsenTrenner = (
  <div style={{ width: 1, height: 48, background: '#d9d9d9', alignSelf: 'center', flex: 'none' }} />
);

function verteilungTags(v: StatusVerteilung | null) {
  if (!v) return null;
  return (
    <Space size={4}>
      {v.verfuegbar > 0 && <Tag color="green">{v.verfuegbar} frei</Tag>}
      {v.gebunden > 0 && <Tag color="gold">{v.gebunden} geb.</Tag>}
      {v.nicht_verfuegbar > 0 && <Tag color="red">{v.nicht_verfuegbar} n.v.</Tag>}
      {v.ohne > 0 && <Tag>{v.ohne} o.A.</Tag>}
    </Space>
  );
}

const spalten: ColumnsType<MeldebildZeile> = [
  {
    title: 'Bezeichnung', dataIndex: 'bezeichnung', key: 'bez',
    render: (_t, z) => <span style={{ fontWeight: z.art === 'abschnitt' ? 600 : 400 }}>{z.bezeichnung}</span>,
  },
  { title: 'Typ / Rolle', dataIndex: 'detail', key: 'detail', responsive: ['md'] },
  {
    title: 'Stärke', key: 'staerke', width: 130,
    render: (_t, z) => (z.art === 'mittel' && z.mittelArt !== 'person') ? null : staerkeText(z.staerke),
  },
  {
    title: 'Status', key: 'status', width: 220,
    render: (_t, z) => {
      if (z.art === 'mittel') {
        if (z.mittelArt === 'material') {
          const text = [z.statusLabel, z.menge != null ? `×${z.menge}` : null].filter(Boolean).join(' · ');
          return text ? <Tag>{text}</Tag> : null;
        }
        const farbe = z.statusKategorie ? KAT_FARBE[z.statusKategorie] : undefined;
        return <Tag color={farbe}>{z.statusLabel ?? z.statusKategorie ?? '—'}</Tag>;
      }
      return (
        <Space size={8}>
          <span>👤</span>{verteilungTags(z.personalVerteilung)}
          <span>🚒</span>{verteilungTags(z.fahrzeugVerteilung)}
        </Space>
      );
    },
  },
];

function alleKeys(zeilen: MeldebildZeile[]): string[] {
  return zeilen.flatMap((z) => [z.key, ...(z.children ? alleKeys(z.children) : [])]);
}

export default function KraefteuebersichtPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  useEinsatzLiveStream(einsatzId);
  const navigate = useNavigate();
  const { message } = AntApp.useApp();

  const [filter, setFilter] = useState<FilterWerte>({ abschnittId: null, traeger: null, kategorie: null, suche: '' });
  const [expandedKeys, setExpandedKeys] = useState<React.Key[]>([]);
  const [printPending, setPrintPending] = useState(false);

  const einsatzQuery = useQuery({ queryKey: ['einsatz', einsatzId], queryFn: () => ladeEinsatz(einsatzId) });
  // Query-Keys IDENTISCH zu den vom Live-Hook invalidierten Keys (Task 5 erweitert den Hook).
  const einheitenQuery = useQuery({ queryKey: ['einsatz-einheiten', einsatzId], queryFn: () => listeEinheiten(einsatzId) });
  const personalQuery = useQuery({ queryKey: ['einsatz-personal', einsatzId], queryFn: () => listeEinsatzPersonal(einsatzId) });
  const fahrzeugeQuery = useQuery({ queryKey: ['einsatz-fahrzeuge', einsatzId], queryFn: () => listeEinsatzFahrzeuge(einsatzId) });
  const materialQuery = useQuery({ queryKey: ['einsatz-material', einsatzId], queryFn: () => listeEinsatzMaterial(einsatzId) });
  const abschnitteQuery = useQuery({ queryKey: ['einsatz-abschnitte', einsatzId], queryFn: () => listeAbschnitte(einsatzId) });

  const traeger = useMemo(() => [...new Set([
    ...(personalQuery.data ?? []).map((x) => x.traegerorganisation),
    ...(fahrzeugeQuery.data ?? []).map((x) => x.traegerorganisation),
  ].filter((t): t is string => !!t))].sort(), [personalQuery.data, fahrzeugeQuery.data]);

  const bild = useMemo(() => {
    const roh: Rohdaten = {
      abschnitte: abschnitteQuery.data ?? [],
      einheiten: einheitenQuery.data ?? [],
      personal: personalQuery.data ?? [],
      fahrzeuge: fahrzeugeQuery.data ?? [],
      material: materialQuery.data ?? [],
    };
    const gefiltert = filtereKraefte(roh, filter);
    return baueKraeftebild(
      gefiltert.abschnitte, gefiltert.einheiten, gefiltert.personal,
      gefiltert.fahrzeuge, gefiltert.material,
    );
  }, [abschnitteQuery.data, einheitenQuery.data, personalQuery.data, fahrzeugeQuery.data, materialQuery.data, filter]);

  const uebernehmen = useMutation({
    mutationFn: async () => {
      const stand = new Date().toLocaleString('de-DE');
      const md = rendereMeldebildMarkdown(bild, stand);
      const lb = await legeLageberichtAn(einsatzId, { vorlage: 'freitext', titel: `Kräftemeldebild ${stand}` });
      // Hinweis: Schlägt der PATCH fehl, bleibt ein leerer Entwurf zurück (vom EL löschbar).
      // Atomar wäre nur mit eigenem Backend-Endpoint — bewusst v1-Kompromiss.
      await aktualisiereLagebericht(einsatzId, lb.id, { abschnitte: [{ schluessel: 'text', text: md }] });
      return lb.id;
    },
    onSuccess: (lbId) => navigate(`/einsaetze/${einsatzId}/lageberichte/${lbId}`),
    onError: () => message.error('Übernahme fehlgeschlagen'),
  });

  // Erst nach committetem Aufklappen drucken (sonst kollabierte Zeilen bei großen Bäumen).
  useEffect(() => {
    if (printPending) {
      window.print();
      setPrintPending(false);
    }
  }, [printPending]);

  // Tabelle bleibt nach dem Druck bewusst voll aufgeklappt (kein Restore in v1).
  const handleDrucken = () => {
    setExpandedKeys(alleKeys(bild.baum));
    setPrintPending(true);
  };

  if (einsatzQuery.isLoading) return <div style={{ textAlign: 'center', paddingTop: 80 }}><Spin size="large" /></div>;
  if (einsatzQuery.isError || !einsatzQuery.data) return <Alert type="error" message="Einsatz nicht gefunden oder kein Zugriff" showIcon />;
  const einsatz = einsatzQuery.data;
  const v = bild.verdichtung;
  const darfSchreiben = einsatz.status === 'aktiv' && (einsatz.meine_rolle === 'einsatzleitung' || einsatz.meine_rolle === 'fuehrungspersonal');

  return (
    <div className="kraefte-print-root">
      <Breadcrumb className="kraefte-no-print" style={{ marginBottom: 12 }}
        items={[{ title: <Link to="/einsaetze">Einsätze</Link> }, { title: einsatz.bezeichnung }, { title: 'Kräfteübersicht' }]} />
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 4 }}>
        <Typography.Title level={3} style={{ marginTop: 0 }}>Kräfteübersicht</Typography.Title>
        <Space className="kraefte-no-print">
          {darfSchreiben && (
            <Button loading={uebernehmen.isPending} onClick={() => uebernehmen.mutate()}>In Lagebericht übernehmen</Button>
          )}
          <Button onClick={handleDrucken}>Drucken / als PDF</Button>
        </Space>
      </Space>
      <Card size="small" style={{ marginBottom: 16 }} styles={{ body: { overflowX: 'auto' } }}>
        {/* Monitoring-Kopf: nicht umbrechend, bei schmalem Viewport horizontal scrollbar. */}
        <Space size="large" align="start" style={{ flexWrap: 'nowrap' }}>
          {/* Achse 1: Personalstärke */}
          <Space size="large">
            <Statistic title="Gesamtstärke (F/UF/M/Ges)" value={staerkeText(v.staerke)} />
            <Statistic title="Personal" value={v.anzahlPersonal} />
          </Space>

          {achsenTrenner}

          {/* Achse 2: Fahrzeug-Verfügbarkeit */}
          <Space size="large">
            <Statistic title="Fahrzeuge" value={v.anzahlFahrzeuge} />
            <Statistic title="Fzg frei" value={v.fahrzeugStatus.verfuegbar} valueStyle={{ color: '#52c41a' }} />
            <Statistic title="Fzg gebunden" value={v.fahrzeugStatus.gebunden} valueStyle={{ color: '#faad14' }} />
            <Statistic title="Fzg n. einsatzbereit" value={v.fahrzeugStatus.nicht_verfuegbar} valueStyle={{ color: '#ff4d4f' }} />
          </Space>

          {achsenTrenner}

          {/* Achse 3: Material */}
          <Space size="large">
            <Statistic title="Material (Pos.)" value={v.anzahlMaterialPositionen} />
            {MAT_STATUS_ANZEIGE.map(({ key, label, farbe }) =>
              v.materialStatus[key] > 0 ? (
                <Statistic
                  key={key}
                  title={label}
                  value={v.materialStatus[key]}
                  valueStyle={farbe ? { color: farbe } : undefined}
                />
              ) : null,
            )}
          </Space>
        </Space>
      </Card>
      <Card size="small" className="kraefte-no-print" style={{ marginBottom: 12 }}>
        <Space wrap>
          <Select
            placeholder="Abschnitt"
            allowClear
            style={{ minWidth: 160 }}
            value={filter.abschnittId ?? undefined}
            options={(abschnitteQuery.data ?? []).map((a) => ({ value: a.id, label: a.name }))}
            onChange={(v) => setFilter((f) => ({ ...f, abschnittId: v ?? null }))}
          />
          <Select
            placeholder="Trägerorganisation"
            allowClear
            style={{ minWidth: 180 }}
            value={filter.traeger ?? undefined}
            options={traeger.map((t) => ({ value: t, label: t }))}
            onChange={(v) => setFilter((f) => ({ ...f, traeger: v ?? null }))}
          />
          <Select
            placeholder="Status"
            allowClear
            style={{ minWidth: 160 }}
            value={filter.kategorie ?? undefined}
            options={[
              { value: 'verfuegbar' as const, label: 'verfügbar' },
              { value: 'gebunden' as const, label: 'gebunden' },
              { value: 'nicht_verfuegbar' as const, label: 'nicht verfügbar' },
            ]}
            onChange={(v) => setFilter((f) => ({ ...f, kategorie: v ?? null }))}
          />
          <Input.Search
            placeholder="Suche..."
            allowClear
            style={{ width: 220 }}
            value={filter.suche}
            onChange={(e) => setFilter((f) => ({ ...f, suche: e.target.value }))}
          />
        </Space>
      </Card>
      <Table<MeldebildZeile>
        size="small" columns={spalten} dataSource={bild.baum} pagination={false}
        rowKey="key"
        expandable={{
          expandedRowKeys: expandedKeys,
          onExpandedRowsChange: (keys) => setExpandedKeys([...keys]),
          childrenColumnName: 'children',
        }}
        locale={{ emptyText: 'Keine Kräfte im Einsatz disponiert' }} />
    </div>
  );
}
