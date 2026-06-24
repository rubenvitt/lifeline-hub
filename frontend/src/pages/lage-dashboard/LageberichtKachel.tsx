import { Card, Empty, Space, Tag, Typography } from 'antd';
import type { LageberichtAnzeige } from '../../api/types';
import { aufTaste } from './klickbar';

interface Props {
  bericht: LageberichtAnzeige | null;
  onNavigate: (route: string) => void;
}

export default function LageberichtKachel({ bericht, onNavigate }: Props) {
  return (
    <Card size="small" title="Aktueller Lagebericht" hoverable role="button" tabIndex={0} onClick={() => onNavigate('lageberichte')} onKeyDown={aufTaste(() => onNavigate('lageberichte'))} style={{ height: '100%', cursor: 'pointer' }}>
      {bericht === null ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Noch kein Lagebericht" />
      ) : (
        <Space orientation="vertical" size={4} style={{ width: '100%' }}>
          <Typography.Text strong>{bericht.titel}</Typography.Text>
          <Space size={6}>
            <Tag color={bericht.status === 'freigegeben' ? 'green' : 'default'}>{bericht.status}</Tag>
            <Typography.Text type="secondary">{bericht.zeitstand}</Typography.Text>
          </Space>
          <Typography.Text type="secondary">von {bericht.ersteller_name}</Typography.Text>
        </Space>
      )}
    </Card>
  );
}
