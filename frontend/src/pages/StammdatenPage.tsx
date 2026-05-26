import { Tabs, Typography } from 'antd';
import StichworteTab from '../stammdaten/StichworteTab';
import FahrzeugeTab from '../stammdaten/FahrzeugeTab';
import StatusKatalogTab from '../stammdaten/StatusKatalogTab';

export default function StammdatenPage() {
  return (
    <div style={{ maxWidth: 960, margin: '0 auto', paddingTop: 24 }}>
      <Typography.Title level={3}>Stammdaten</Typography.Title>
      <Tabs
        defaultActiveKey="stichworte"
        items={[
          { key: 'stichworte', label: 'Einsatz-Stichworte', children: <StichworteTab /> },
          { key: 'fahrzeuge', label: 'Fahrzeuge', children: <FahrzeugeTab /> },
          { key: 'status', label: 'Fahrzeug-Status', children: <StatusKatalogTab /> },
        ]}
      />
    </div>
  );
}
