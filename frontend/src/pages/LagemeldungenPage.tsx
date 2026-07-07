import { Alert, Breadcrumb, Empty, Space, Spin, Tag, Typography } from 'antd';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ladeEinsatz } from '../api/einsaetze';
import { listeLageMeldungen } from '../api/meldungen';
import KoordinatenAnzeige from '../anzeige/KoordinatenAnzeige';
import { Liste, ListenEintrag, ListenEintragMeta } from '../components/Liste';

export default function LagemeldungenPage() {
  const { id } = useParams();
  const einsatzId = Number(id);

  const einsatzQuery = useQuery({ queryKey: ['einsatz', einsatzId], queryFn: () => ladeEinsatz(einsatzId) });
  const lageQuery = useQuery({
    queryKey: ['einsatz-lagemeldungen', einsatzId],
    queryFn: () => listeLageMeldungen(einsatzId),
  });

  if (einsatzQuery.isLoading) {
    return <div style={{ textAlign: 'center', paddingTop: 80 }}><Spin size="large" /></div>;
  }
  if (einsatzQuery.isError || !einsatzQuery.data) {
    return <Alert type="error" title="Einsatz nicht gefunden oder kein Zugriff" showIcon />;
  }
  const einsatz = einsatzQuery.data;
  const eintraege = lageQuery.data ?? [];

  return (
    <div>
      <Breadcrumb style={{ marginBottom: 12 }} items={[
        { title: <Link to="/einsaetze">Einsätze</Link> },
        { title: einsatz.bezeichnung },
        { title: 'Lagemeldungen' },
      ]} />
      <Typography.Title level={3} style={{ marginTop: 0 }}>Lagerelevante Meldungen</Typography.Title>
      {lageQuery.isError && (
        <Alert type="error" showIcon style={{ marginBottom: 12 }} title="Lageobjekte konnten nicht geladen werden" />
      )}
      {eintraege.length === 0 ? (
        <Empty description="Noch keine lagerelevanten Meldungen übergeben" />
      ) : (
        <Liste
          dataSource={eintraege}
          renderItem={(l) => (
            <ListenEintrag>
              <ListenEintragMeta
                title={<Typography.Text strong>{l.text}</Typography.Text>}
                description={
                  <Space wrap>
                    <Tag color="gold">Lageobjekt</Tag>
                    <Typography.Text type="secondary">
                      Herkunft: Meldung #{l.meldung_lfd_nr} von {l.meldung_absender}
                    </Typography.Text>
                    {l.lat != null && l.lon != null && (
                      <KoordinatenAnzeige lat={l.lat} lon={l.lon} einsatzId={einsatzId} exclude={`lagemeldung:${l.id}`} />
                    )}
                  </Space>
                }
              />
            </ListenEintrag>
          )}
        />
      )}
    </div>
  );
}
