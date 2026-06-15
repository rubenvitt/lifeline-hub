import { Alert, Breadcrumb, Empty, List, Space, Spin, Tag, Typography } from 'antd';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ladeEinsatz } from '../api/einsaetze';
import { listeLageMeldungen } from '../api/meldungen';

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
    return <Alert type="error" message="Einsatz nicht gefunden oder kein Zugriff" showIcon />;
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
        <Alert type="error" showIcon style={{ marginBottom: 12 }} message="Lageobjekte konnten nicht geladen werden" />
      )}
      {eintraege.length === 0 ? (
        <Empty description="Noch keine lagerelevanten Meldungen übergeben" />
      ) : (
        <List
          dataSource={eintraege}
          renderItem={(l) => (
            <List.Item>
              <List.Item.Meta
                title={<Typography.Text strong>{l.text}</Typography.Text>}
                description={
                  <Space wrap>
                    <Tag color="gold">Lageobjekt</Tag>
                    <Typography.Text type="secondary">
                      Herkunft: Meldung #{l.meldung_lfd_nr} von {l.meldung_absender}
                    </Typography.Text>
                    {l.lat != null && l.lon != null && (
                      <Typography.Text type="secondary">Geo: {l.lat.toFixed(5)}, {l.lon.toFixed(5)}</Typography.Text>
                    )}
                  </Space>
                }
              />
            </List.Item>
          )}
        />
      )}
    </div>
  );
}
