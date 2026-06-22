import { Alert, Breadcrumb, Button, Space, Spin, Table, Tag, Typography, type TableColumnsType } from 'antd';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ladeEinsatz } from '../api/einsaetze';
import { listeUhs } from '../api/einsatzUhs';
import { useUhsStream } from '../etb/useUhsStream';
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
  useUhsStream(einsatzId);

  const einsatzQuery = useQuery({ queryKey: ['einsatz', einsatzId], queryFn: () => ladeEinsatz(einsatzId) });
  const uhsQuery = useQuery({
    queryKey: ['einsatz-uhs', einsatzId],
    queryFn: () => listeUhs(einsatzId),
  });

  const [anlegen, setAnlegen] = useState(false);

  const ist_aktiv = einsatzQuery.data?.status === 'aktiv';
  const ist_beobachter = einsatzQuery.data?.meine_rolle === 'beobachter';
  const schreibgeschuetzt = !ist_aktiv || ist_beobachter;

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
        <Link to={`/einsaetze/${einsatzId}/unfallhilfsstellen/${u.id}`}>{b}</Link> },
    { title: 'Typ', dataIndex: 'typ', render: (t: UhsTyp) => UHS_TYP_LABEL[t] },
    { title: 'Status', dataIndex: 'status', render: (s: UhsStatus) => {
      const meta = STATUS_META[s];
      return <Tag color={meta.color}>{meta.label}</Tag>;
    }},
    { title: 'Standort', dataIndex: 'standort', render: (s: string | null) => s ?? '—' },
  ];

  if (einsatzQuery.isLoading || uhsQuery.isLoading) return <Spin />;
  if (einsatzQuery.error) return <Alert type="error" message="Einsatz konnte nicht geladen werden" />;

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
