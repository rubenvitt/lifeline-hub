import { Alert, Breadcrumb, Spin, Tabs } from 'antd';
import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ladeEinsatz } from '../api/einsaetze';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { useAuth } from '../auth/AuthContext';
import { einsatzKeys } from '../api/queryKeys';
import AuftraegeListe from '../auftraege/AuftraegeListe';
import BefehlListe from '../auftraege/BefehlListe';

export default function AuftraegePage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { benutzer } = useAuth();

  const einsatzQuery = useQuery({ queryKey: einsatzKeys.einsatz(einsatzId), queryFn: () => ladeEinsatz(einsatzId) });

  if (einsatzQuery.isLoading) {
    return <div style={{ textAlign: 'center', paddingTop: 80 }}><Spin size="large" /></div>;
  }
  if (einsatzQuery.isError || !einsatzQuery.data) {
    return <Alert type="error" title="Einsatz nicht gefunden oder kein Zugriff" showIcon />;
  }
  const einsatz = einsatzQuery.data;
  const darfSchreiben = darfImEinsatzSchreiben(einsatz, benutzer);

  return (
    <div style={{ maxWidth: 1040, margin: '0 auto' }}>
      <Breadcrumb
        style={{ marginBottom: 12 }}
        items={[
          { title: <Link to="/einsaetze">Einsätze</Link> },
          { title: einsatz.bezeichnung },
          { title: 'Aufträge/Befehle' },
        ]}
      />
      <Tabs
        defaultActiveKey="auftraege"
        items={[
          {
            key: 'auftraege',
            label: 'Aufträge',
            children: <AuftraegeListe einsatzId={einsatzId} darfSchreiben={darfSchreiben} />,
          },
          {
            key: 'befehle',
            label: 'Befehle',
            children: <BefehlListe einsatzId={einsatzId} darfSchreiben={darfSchreiben} />,
          },
        ]}
      />
    </div>
  );
}
