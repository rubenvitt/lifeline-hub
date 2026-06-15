import { Card, Empty, Space, Statistic, Tag } from 'antd';
import type { Meldung } from '../../api/types';
import { aufTaste } from './klickbar';

interface Props {
  meldungen: Meldung[] | null;
  onNavigate: (route: string) => void;
}

export default function MeldungenKachel({ meldungen, onNavigate }: Props) {
  const offen = meldungen?.filter((m) => m.ist_offen).length ?? 0;
  const neu = meldungen?.filter((m) => m.status === 'neu').length ?? 0;
  const ueberfaellig = meldungen?.filter((m) => m.ist_ueberfaellig).length ?? 0;

  return (
    <Card
      size="small"
      title="Meldungen (eingehend)"
      hoverable
      role="button"
      tabIndex={0}
      onClick={() => onNavigate('meldungen')}
      onKeyDown={aufTaste(() => onNavigate('meldungen'))}
      style={{ height: '100%', cursor: 'pointer' }}
    >
      {meldungen === null ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Meldungen nicht verfügbar" />
      ) : (
        <Space size={24} wrap>
          <Statistic title="Offen" value={offen} />
          <Statistic title="Neu" value={neu} />
          {ueberfaellig > 0 && (
            <Tag color="error" style={{ fontSize: 14, padding: '4px 10px' }}>
              {ueberfaellig} überfällig
            </Tag>
          )}
        </Space>
      )}
    </Card>
  );
}
