import { Tabs, Typography } from 'antd';
import StichworteTab from '../stammdaten/StichworteTab';

export default function StammdatenPage() {
  return (
    <div style={{ maxWidth: 960, margin: '0 auto', paddingTop: 24 }}>
      <Typography.Title level={3}>Stammdaten</Typography.Title>
      <Tabs
        defaultActiveKey="stichworte"
        items={[
          { key: 'stichworte', label: 'Einsatz-Stichworte', children: <StichworteTab /> },
        ]}
      />
    </div>
  );
}
