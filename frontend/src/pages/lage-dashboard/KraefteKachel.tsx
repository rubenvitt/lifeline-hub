import { Card, Empty, Space, Statistic, Tag, Typography } from 'antd';
import type { Verdichtung } from '../../kraefte/kraeftebild';
import { staerkeText } from '../../kraefte/kraeftebild';
import { aufTaste } from './klickbar';

interface Props {
  kraefte: Verdichtung | null;
  einheiten: number | null;
  abschnitte: number | null;
  onNavigate: (route: string) => void;
}

export default function KraefteKachel({ kraefte, einheiten, abschnitte, onNavigate }: Props) {
  return (
    <Card size="small" title="Kräfte" hoverable role="button" tabIndex={0} onClick={() => onNavigate('kraefteuebersicht')} onKeyDown={aufTaste(() => onNavigate('kraefteuebersicht'))} style={{ height: '100%', cursor: 'pointer' }}>
      {kraefte === null ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Daten nicht verfügbar" />
      ) : (
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
          <Statistic title="Gesamtstärke (F/UF/M//Ges)" value={staerkeText(kraefte.staerke)} />
          <Space size={4} wrap>
            <Tag color="green">{kraefte.fahrzeugStatus.verfuegbar} Fzg frei</Tag>
            <Tag color="gold">{kraefte.fahrzeugStatus.gebunden} geb.</Tag>
            <Tag color="red">{kraefte.fahrzeugStatus.nicht_verfuegbar} n.v.</Tag>
          </Space>
          <Typography.Text type="secondary">
            {einheiten ?? 0} Einheiten · {abschnitte ?? 0} Abschnitte
          </Typography.Text>
        </Space>
      )}
    </Card>
  );
}
