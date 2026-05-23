import { Alert, App, Button, Space, Spin, Tag, Typography } from 'antd';
import { Link, useParams } from 'react-router-dom';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ladeEinsatz } from '../api/einsaetze';
import { SEITENGROESSE, erfasseEtb, listeEtb, type EtbFilterWerte, type NeuerEintrag } from '../api/etb';
import { ApiError } from '../api/client';
import type { EtbEintragAnzeige } from '../api/types';
import { useState } from 'react';
import EtbTabelle from '../etb/EtbTabelle';
import EtbFilterleiste from '../etb/EtbFilterleiste';
import Schnellerfassung from '../etb/Schnellerfassung';

export default function EtbPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const [filter, setFilter] = useState<EtbFilterWerte>({});

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

  const qc = useQueryClient();
  const { message } = App.useApp();
  const [berichtigungZu, setBerichtigungZu] = useState<EtbEintragAnzeige | null>(null);

  const erfassungMutation = useMutation({
    mutationFn: (e: NeuerEintrag) => erfasseEtb(einsatzId, e),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['etb', einsatzId] }),
  });

  async function erfassen(e: NeuerEintrag) {
    try {
      await erfassungMutation.mutateAsync(e);
    } catch (err) {
      message.error(err instanceof ApiError ? err.message : 'Senden fehlgeschlagen');
      throw err;
    }
  }

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

  const darfSchreiben =
    einsatz.status === 'aktiv' &&
    (einsatz.meine_rolle === 'einsatzleitung' || einsatz.meine_rolle === 'fuehrungspersonal');

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

      <EtbFilterleiste onChange={setFilter} />
      <EtbTabelle
        eintraege={eintraege}
        onBerichtigen={darfSchreiben ? (e) => setBerichtigungZu(e) : undefined}
      />

      {etbQuery.hasNextPage && (
        <div style={{ textAlign: 'center', marginTop: 12 }}>
          <Button onClick={() => etbQuery.fetchNextPage()} loading={etbQuery.isFetchingNextPage}>
            Ältere laden
          </Button>
        </div>
      )}

      {darfSchreiben && (
        <Schnellerfassung
          erfassen={erfassen}
          berichtigungZu={berichtigungZu}
          onBerichtigungAbbrechen={() => setBerichtigungZu(null)}
        />
      )}
    </div>
  );
}
