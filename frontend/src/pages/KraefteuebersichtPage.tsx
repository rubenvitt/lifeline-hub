import { Alert, Breadcrumb, Card, Space, Spin, Statistic, Typography } from 'antd';
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
import { baueKraeftebild, type StaerkeSumme } from '../kraefte/kraeftebild';

export function staerkeText(s: StaerkeSumme): string {
  return `${s.fuehrer}/${s.unterfuehrer}/${s.mannschaft}/${s.gesamt}`;
}

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
      {/* Tabelle folgt in Task 3 */}
    </div>
  );
}
