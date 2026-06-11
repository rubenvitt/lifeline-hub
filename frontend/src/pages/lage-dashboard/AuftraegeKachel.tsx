import { Card, Empty, Space, Statistic, Tag } from 'antd';
import type { Auftrag } from '../../api/types';
import { aufTaste } from './klickbar';

interface Props {
  auftraege: Auftrag[] | null;
  onNavigate: (route: string) => void;
}

export default function AuftraegeKachel({ auftraege, onNavigate }: Props) {
  const offen = auftraege?.filter(
    (a) => a.bearbeitungsstatus !== 'vollzogen' && a.bearbeitungsstatus !== 'abgenommen',
  ).length ?? 0;
  const ueberfaellig = auftraege?.filter((a) => a.ist_ueberfaellig).length ?? 0;

  return (
    <Card
      size="small"
      title="Aufträge / Befehle"
      hoverable
      role="button"
      tabIndex={0}
      onClick={() => onNavigate('auftraege')}
      onKeyDown={aufTaste(() => onNavigate('auftraege'))}
      style={{ height: '100%', cursor: 'pointer' }}
    >
      {auftraege === null ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Aufträge nicht verfügbar" />
      ) : (
        <Space size={24} wrap>
          <Statistic title="Offen / in Arbeit" value={offen} />
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
