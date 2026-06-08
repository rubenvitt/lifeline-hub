import { Card, Space, Typography } from 'antd';
import type { SchadenVerdichtung, TierVerdichtung, UhsVerdichtung } from './lageVerdichtung';

interface Props {
  uhs: UhsVerdichtung | null;
  schaeden: SchadenVerdichtung | null;
  tiere: TierVerdichtung | null;
  zonen: number | null;
  onNavigate: (route: string) => void;
}

const STRICH = '—';
const zeile = (label: string, wert: string) => (
  <Typography.Text>{label}: {wert}</Typography.Text>
);

export default function InfrastrukturKachel({ uhs, schaeden, tiere, zonen, onNavigate }: Props) {
  return (
    <Card size="small" title="Infrastruktur & Gefahren" style={{ height: '100%' }}>
      <Space direction="vertical" size={6} style={{ width: '100%' }}>
        <div role="button" tabIndex={0} style={{ cursor: 'pointer' }} onClick={() => onNavigate('unfallhilfsstellen')} onKeyDown={(e) => { if (e.key === 'Enter') onNavigate('unfallhilfsstellen'); }}>
          {uhs ? zeile('UHS', `${uhs.gesamt} (${uhs.aktiv} aktiv)`) : zeile('UHS', STRICH)}
        </div>
        <div role="button" tabIndex={0} style={{ cursor: 'pointer' }} onClick={() => onNavigate('schaeden')} onKeyDown={(e) => { if (e.key === 'Enter') onNavigate('schaeden'); }}>
          {schaeden ? zeile('Schäden', `${schaeden.offen} offen · ${schaeden.uebergeben} überg. · ${schaeden.abgeschlossen} erl.`) : zeile('Schäden', STRICH)}
        </div>
        <div role="button" tabIndex={0} style={{ cursor: 'pointer' }} onClick={() => onNavigate('tiere')} onKeyDown={(e) => { if (e.key === 'Enter') onNavigate('tiere'); }}>
          {tiere ? zeile('Tiere', `${tiere.gesamt} (${tiere.aktiv} aktiv)`) : zeile('Tiere', STRICH)}
        </div>
        <div role="button" tabIndex={0} style={{ cursor: 'pointer' }} onClick={() => onNavigate('gefahren')} onKeyDown={(e) => { if (e.key === 'Enter') onNavigate('gefahren'); }}>
          {zonen !== null ? zeile('Gefahren-/Absperrzonen', String(zonen)) : zeile('Gefahren-/Absperrzonen', STRICH)}
        </div>
      </Space>
    </Card>
  );
}
