import { Alert, Breadcrumb, Card, Space, Spin, Statistic, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { Link, useParams } from 'react-router-dom';
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ladeEinsatz } from '../api/einsaetze';
import { listeEinheiten } from '../api/einheiten';
import { listeEinsatzPersonal } from '../api/einsatzPersonal';
import { listeEinsatzFahrzeuge } from '../api/einsatzFahrzeuge';
import { listeEinsatzMaterial } from '../api/einsatzMaterial';
import { listeAbschnitte } from '../api/einsatzabschnitte';
import { useEinsatzLiveStream } from '../etb/useEinsatzLiveStream';
import { baueKraeftebild, type MeldebildZeile, type StaerkeSumme, type StatusVerteilung } from '../kraefte/kraeftebild';
import type { StatusKategorie } from '../api/types';

export function staerkeText(s: StaerkeSumme): string {
  return `${s.fuehrer}/${s.unterfuehrer}/${s.mannschaft}/${s.gesamt}`;
}

const KAT_FARBE: Record<StatusKategorie, string> = { verfuegbar: 'green', gebunden: 'gold', nicht_verfuegbar: 'red' };

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

export default function KraefteuebersichtPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  useEinsatzLiveStream(einsatzId);

  const einsatzQuery = useQuery({ queryKey: ['einsatz', einsatzId], queryFn: () => ladeEinsatz(einsatzId) });
  // Query-Keys IDENTISCH zu den vom Live-Hook invalidierten Keys (Task 5 erweitert den Hook).
  const einheitenQuery = useQuery({ queryKey: ['einsatz-einheiten', einsatzId], queryFn: () => listeEinheiten(einsatzId) });
  const personalQuery = useQuery({ queryKey: ['einsatz-personal', einsatzId], queryFn: () => listeEinsatzPersonal(einsatzId) });
  const fahrzeugeQuery = useQuery({ queryKey: ['einsatz-fahrzeuge', einsatzId], queryFn: () => listeEinsatzFahrzeuge(einsatzId) });
  const materialQuery = useQuery({ queryKey: ['einsatz-material', einsatzId], queryFn: () => listeEinsatzMaterial(einsatzId) });
  const abschnitteQuery = useQuery({ queryKey: ['einsatz-abschnitte', einsatzId], queryFn: () => listeAbschnitte(einsatzId) });

  const bild = useMemo(() => baueKraeftebild(
    abschnitteQuery.data ?? [], einheitenQuery.data ?? [], personalQuery.data ?? [],
    fahrzeugeQuery.data ?? [], materialQuery.data ?? [],
  ), [abschnitteQuery.data, einheitenQuery.data, personalQuery.data, fahrzeugeQuery.data, materialQuery.data]);

  if (einsatzQuery.isLoading) return <div style={{ textAlign: 'center', paddingTop: 80 }}><Spin size="large" /></div>;
  if (einsatzQuery.isError || !einsatzQuery.data) return <Alert type="error" message="Einsatz nicht gefunden oder kein Zugriff" showIcon />;
  const einsatz = einsatzQuery.data;
  const v = bild.verdichtung;

  return (
    <div>
      <Breadcrumb style={{ marginBottom: 12 }}
        items={[{ title: <Link to="/einsaetze">Einsätze</Link> }, { title: einsatz.bezeichnung }, { title: 'Kräfteübersicht' }]} />
      <Typography.Title level={3} style={{ marginTop: 0 }}>Kräfteübersicht</Typography.Title>
      <Card size="small" style={{ marginBottom: 16 }}>
        <Space size="large" wrap>
          <Statistic title="Gesamtstärke (F/UF/M/Ges)" value={staerkeText(v.staerke)} />
          <Statistic title="Personal" value={v.anzahlPersonal} />
          <Statistic title="Fahrzeuge" value={v.anzahlFahrzeuge} />
          <Statistic title="Material" value={v.anzahlMaterialPositionen} />
        </Space>
      </Card>
      <Table<MeldebildZeile>
        size="small" columns={spalten} dataSource={bild.baum} pagination={false}
        rowKey="key" expandable={{ defaultExpandAllRows: false, childrenColumnName: 'children' }}
        locale={{ emptyText: 'Keine Kräfte im Einsatz disponiert' }} />
    </div>
  );
}
