import { Alert, Breadcrumb, Button, Space, Spin, Table, Tag, Typography, type TableColumnsType } from 'antd';
import { Link, useParams, useSearchParams } from 'react-router-dom';
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

const UHS_TYP_LABEL: Record<UhsTyp, string> = {
  patientenablage: 'Patientenablage',
  behandlungsplatz: 'Behandlungsplatz',
  verletztensammelstelle: 'Verletztensammelstelle',
  sonstige: 'Sonstige',
};

const STATUS_META: Record<UhsStatus, { label: string; color: string }> = {
  geplant: { label: 'geplant', color: 'default' },
  aktiv: { label: 'aktiv', color: 'green' },
  aufgeloest: { label: 'aufgelöst', color: 'red' },
};

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
    { title: 'Typ', dataIndex: 'typ', render: (t: UhsTyp) => UHS_TYP_LABEL[t] },
    { title: 'Status', dataIndex: 'status', render: (s: UhsStatus) => {
      const meta = STATUS_META[s];
      return <Tag color={meta.color}>{meta.label}</Tag>;
    }},
    { title: 'Standort', dataIndex: 'standort', render: (s: string | null) => s ?? '—' },
  ];

  if (einsatzQuery.isLoading || uhsQuery.isLoading) return <Spin />;
  if (einsatzQuery.error) return <Alert type="error" title="Einsatz konnte nicht geladen werden" />;

  return (
    <div style={{ padding: 16 }}>
      <Breadcrumb items={[
        { title: <Link to="/einsaetze">Einsätze</Link> },
        { title: <Link to={`/einsaetze/${einsatzId}`}>{einsatzQuery.data?.bezeichnung}</Link> },
        { title: 'Unfallhilfsstellen' },
      ]} />
      <Space style={{ marginTop: 12, marginBottom: 12 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>Unfallhilfsstellen</Typography.Title>
        <Button type="primary" disabled={schreibgeschuetzt} onClick={() => setAnlegen(true)}>Neu</Button>
      </Space>
      <Table<Uhs>
        rowKey="id"
        dataSource={uhsQuery.data ?? []}
        columns={spalten}
        size="middle"
        pagination={false}
      />

      <UhsAnlegenDrawer einsatzId={einsatzId} open={anlegen} onClose={() => setAnlegen(false)} />
    </div>
  );
}
