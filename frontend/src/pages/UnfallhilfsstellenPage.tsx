import { Breadcrumb, Button, Table, type TableColumnsType } from 'antd';
import { Link, useParams, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { uhsDetailPfad } from '../routing/deeplinks';
import { useEffect, useState } from 'react';
import { ladeEinsatz } from '../api/einsaetze';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { useAuth } from '../auth/AuthContext';
import { listeUhs } from '../api/einsatzUhs';
import { einsatzKeys } from '../api/queryKeys';
import UhsAnlegenDrawer from './uhs/UhsAnlegenDrawer';
import type { Uhs, UhsStatus, UhsTyp } from '../api/types';
import EinsatzSeite from '../components/EinsatzSeite';
import StatusTag from '../components/StatusTag';
import { SeitenFehler, SeitenSkeleton } from '../components/SeitenZustand';
import { uhsStatus, uhsTyp } from '../theme/statusFarben';

export default function UnfallhilfsstellenPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { benutzer } = useAuth();
  // Live-Updates über den konsolidierten useEinsatzLiveStream im EinsatzLayout (LFH-207).

  const einsatzQuery = useQuery({ queryKey: einsatzKeys.einsatz(einsatzId), queryFn: () => ladeEinsatz(einsatzId) });
  const uhsQuery = useQuery({
    queryKey: einsatzKeys.uhs(einsatzId),
    queryFn: () => listeUhs(einsatzId),
  });

  const [anlegen, setAnlegen] = useState(false);

  const schreibgeschuetzt = !darfImEinsatzSchreiben(einsatzQuery.data, benutzer);

  const [searchParams, setSearchParams] = useSearchParams();
  // Schnellaktion: ?neu=1 öffnet den Anlegen-Drawer, sobald die Rechte feststehen (LFH-11).
  useEffect(() => {
    if (searchParams.get('neu') !== '1') return;
    if (einsatzQuery.isLoading) return;
    if (!schreibgeschuetzt) setAnlegen(true);
    searchParams.delete('neu');
    setSearchParams(searchParams, { replace: true });
  }, [searchParams, setSearchParams, einsatzQuery.isLoading, schreibgeschuetzt]);

  const spalten: TableColumnsType<Uhs> = [
    { title: 'Bezeichnung', dataIndex: 'bezeichnung', render: (b: string, u) =>
        <Link to={uhsDetailPfad(einsatzId, u.id)}>{b}</Link> },
    { title: 'Typ', dataIndex: 'typ', render: (t: UhsTyp) => uhsTyp[t].label },
    { title: 'Status', dataIndex: 'status', render: (s: UhsStatus) => <StatusTag darstellung={uhsStatus[s]} /> },
    { title: 'Standort', dataIndex: 'standort', render: (s: string | null) => s ?? '—' },
  ];

  if (einsatzQuery.isLoading || uhsQuery.isLoading) return <SeitenSkeleton />;
  if (einsatzQuery.error) return <SeitenFehler text="Einsatz konnte nicht geladen werden" />;

  return (
    <EinsatzSeite
      titel="Unfallhilfsstellen"
      breadcrumb={
        <Breadcrumb items={[
          { title: <Link to="/einsaetze">Einsätze</Link> },
          { title: <Link to={`/einsaetze/${einsatzId}`}>{einsatzQuery.data?.bezeichnung}</Link> },
          { title: 'Unfallhilfsstellen' },
        ]} />
      }
      aktionen={
        <Button type="primary" disabled={schreibgeschuetzt} onClick={() => setAnlegen(true)}>Neu</Button>
      }
    >
      <Table<Uhs>
        rowKey="id"
        dataSource={uhsQuery.data ?? []}
        columns={spalten}
        pagination={false}
      />

      <UhsAnlegenDrawer einsatzId={einsatzId} open={anlegen} onClose={() => setAnlegen(false)} />
    </EinsatzSeite>
  );
}
