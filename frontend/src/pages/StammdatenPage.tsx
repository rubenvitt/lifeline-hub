import { Tabs, Typography } from 'antd';
import StichworteTab from '../stammdaten/StichworteTab';
import FahrzeugeTab from '../stammdaten/FahrzeugeTab';
import StatusKatalogTab from '../stammdaten/StatusKatalogTab';
import PersonalTab from '../stammdaten/PersonalTab';
import QualifikationenTab from '../stammdaten/QualifikationenTab';
import PersonalStatusTab from '../stammdaten/PersonalStatusTab';

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
          { key: 'personal', label: 'Personal', children: <PersonalTab /> },
          { key: 'qualifikationen', label: 'Qualifikationen', children: <QualifikationenTab /> },
          { key: 'personal-status', label: 'Personal-Status', children: <PersonalStatusTab /> },
        ]}
      />
    </div>
  );
}
