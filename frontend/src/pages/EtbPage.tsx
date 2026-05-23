import { Alert, Button, Space, Spin, Tag, Typography } from 'antd';
import { Link, useParams } from 'react-router-dom';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { ladeEinsatz } from '../api/einsaetze';
import { SEITENGROESSE, listeEtb, type EtbFilterWerte } from '../api/etb';
import { useState } from 'react';
import EtbTabelle from '../etb/EtbTabelle';

export default function EtbPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const [filter] = useState<EtbFilterWerte>({});

  const einsatzQuery = useQuery({
    queryKey: ['einsatz', einsatzId],
    queryFn: () => ladeEinsatz(einsatzId),
  });

  const etbQuery = useInfiniteQuery({
    queryKey: ['etb', einsatzId, filter],
    queryFn: ({ pageParam }) => listeEtb(einsatzId, { ...filter, before_lfd_nr: pageParam }),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (letzteSeite) =>
      letzteSeite.length === SEITENGROESSE
        ? letzteSeite[letzteSeite.length - 1].lfd_nr
        : undefined,
  });

  const eintraege = etbQuery.data?.pages.flat() ?? [];

  if (einsatzQuery.isLoading) {
    return (
      <div style={{ textAlign: 'center', paddingTop: 80 }}>
        <Spin size="large" />
      </div>
    );
  }
  if (einsatzQuery.isError || !einsatzQuery.data) {
    return <Alert type="error" message="Einsatz nicht gefunden oder kein Zugriff" showIcon />;
  }
  const einsatz = einsatzQuery.data;

  return (
    <div>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }}>
        <Space>
          <Link to="/einsaetze">← Einsätze</Link>
          <Typography.Title level={3} style={{ margin: 0 }}>
            {einsatz.bezeichnung}
          </Typography.Title>
          <Tag color={einsatz.status === 'aktiv' ? 'green' : 'default'}>{einsatz.status}</Tag>
        </Space>
      </Space>

      {etbQuery.isError && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 12 }}
          message="ETB-Einträge konnten nicht geladen werden"
        />
      )}

      <EtbTabelle eintraege={eintraege} />

      {etbQuery.hasNextPage && (
        <div style={{ textAlign: 'center', marginTop: 12 }}>
          <Button onClick={() => etbQuery.fetchNextPage()} loading={etbQuery.isFetchingNextPage}>
            Ältere laden
          </Button>
        </div>
      )}
    </div>
  );
}
