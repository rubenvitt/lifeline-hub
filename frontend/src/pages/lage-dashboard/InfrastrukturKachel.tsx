import { Card, Space, Typography } from 'antd';
import type { SchadenVerdichtung, TierVerdichtung, UhsVerdichtung } from './lageVerdichtung';
import { KlickbareZeile } from './klickbar';

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
        <KlickbareZeile onClick={() => onNavigate('unfallhilfsstellen')}>
          {uhs ? zeile('UHS', `${uhs.gesamt} (${uhs.aktiv} aktiv)`) : zeile('UHS', STRICH)}
        </KlickbareZeile>
        <KlickbareZeile onClick={() => onNavigate('schaeden')}>
          {schaeden ? zeile('Schäden', `${schaeden.offen} offen · ${schaeden.uebergeben} überg. · ${schaeden.abgeschlossen} erl.`) : zeile('Schäden', STRICH)}
        </KlickbareZeile>
        <KlickbareZeile onClick={() => onNavigate('tiere')}>
          {tiere ? zeile('Tiere', `${tiere.gesamt} (${tiere.aktiv} aktiv)`) : zeile('Tiere', STRICH)}
        </KlickbareZeile>
        <KlickbareZeile onClick={() => onNavigate('gefahren')}>
          {zonen !== null ? zeile('Gefahren-/Absperrzonen', String(zonen)) : zeile('Gefahren-/Absperrzonen', STRICH)}
        </KlickbareZeile>
      </Space>
    </Card>
  );
}
