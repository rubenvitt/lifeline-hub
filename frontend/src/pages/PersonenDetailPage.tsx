import { Alert, Breadcrumb, Button, Space, Spin, Tag, Typography } from 'antd';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ladeEinsatz } from '../api/einsaetze';
import { ladePerson, registrierAnzeige } from '../api/einsatzPerson';
import { ApiError } from '../api/client';
import { SK_META, STATUS_META } from '../personen/personMeta';

export default function PersonenDetailPage() {
  const { id, personId: personIdParam } = useParams();
  const einsatzId = Number(id);
  const personId = Number(personIdParam);
  const navigate = useNavigate();

  const einsatzQuery = useQuery({ queryKey: ['einsatz', einsatzId], queryFn: () => ladeEinsatz(einsatzId) });
  const detailQuery = useQuery({
    queryKey: ['einsatz-person', einsatzId, personId],
    queryFn: () => ladePerson(einsatzId, personId),
  });

  if (einsatzQuery.isLoading || detailQuery.isLoading) {
    return <div style={{ textAlign: 'center', paddingTop: 80 }}><Spin size="large" /></div>;
  }
  if (einsatzQuery.isError || !einsatzQuery.data) {
    return <Alert type="error" message="Einsatz nicht gefunden oder kein Zugriff" showIcon />;
  }
  const einsatz = einsatzQuery.data;
  const zurueck = `/einsaetze/${einsatzId}/personen`;

  if (detailQuery.isError) {
    return (
      <Alert
        type="error" showIcon
        message="Person konnte nicht geladen werden"
        description={detailQuery.error instanceof ApiError ? detailQuery.error.message : undefined}
        action={<Button size="small" onClick={() => detailQuery.refetch()}>Erneut versuchen</Button>}
      />
    );
  }
  if (!detailQuery.data) {
    return <Alert type="error" message="Person nicht gefunden" showIcon />;
  }
  const p = detailQuery.data;

  return (
    <div>
      <Breadcrumb
        style={{ marginBottom: 12 }}
        items={[
          { title: <Link to="/einsaetze">Einsätze</Link> },
          { title: einsatz.bezeichnung },
          { title: <Link to={zurueck}>Personen</Link> },
          { title: registrierAnzeige(p.registrier_nr) },
        ]}
      />
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }} align="start">
        <Space>
          <Typography.Title level={3} style={{ margin: 0 }}>
            Person {registrierAnzeige(p.registrier_nr)}
          </Typography.Title>
          <Tag color={STATUS_META[p.status].color}>{STATUS_META[p.status].label}</Tag>
          {p.aktuelle_sichtung && <Tag color={SK_META[p.aktuelle_sichtung].color}>{SK_META[p.aktuelle_sichtung].label}</Tag>}
          {p.storniert_at && <Tag color="default">storniert</Tag>}
        </Space>
        <Button onClick={() => navigate(zurueck)}>Zurück zur Liste</Button>
      </Space>
    </div>
  );
}
