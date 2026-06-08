import { Card, Empty, Space, Tag, Typography } from 'antd';
import type { Sichtungskategorie } from '../../api/types';
import { SK_META, STATUS_META } from '../../personen/personMeta';
import type { BetroffeneVerdichtung } from './lageVerdichtung';
import { aufTaste } from './klickbar';

interface Props {
  betroffene: BetroffeneVerdichtung | null;
  onNavigate: (route: string) => void;
}

const SK_REIHENFOLGE: Sichtungskategorie[] = ['sk1', 'sk2', 'sk3', 'sk4', 'tot', 'unverletzt'];

export default function BetroffeneKachel({ betroffene, onNavigate }: Props) {
  return (
    <Card size="small" title="Betroffene" hoverable role="button" tabIndex={0} onClick={() => onNavigate('personen')} onKeyDown={aufTaste(() => onNavigate('personen'))} style={{ height: '100%', cursor: 'pointer' }}>
      {betroffene === null ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Daten nicht verfügbar" />
      ) : (
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
          <Typography.Text type="secondary">{betroffene.gesamt} Personen erfasst</Typography.Text>
          <Space size={4} wrap>
            {SK_REIHENFOLGE.map((sk) => (
              <Tag key={sk} color={SK_META[sk].color === 'default' ? undefined : SK_META[sk].color}>
                {SK_META[sk].label} {betroffene.sk[sk]}
              </Tag>
            ))}
          </Space>
          <Space size={4} wrap>
            <Tag color={STATUS_META.vermisst.color}>vermisst {betroffene.status.vermisst}</Tag>
            <Tag color={STATUS_META.betroffen.color}>betroffen {betroffene.status.betroffen}</Tag>
            <Tag color={STATUS_META.verstorben.color}>verstorben {betroffene.status.verstorben}</Tag>
          </Space>
        </Space>
      )}
    </Card>
  );
}
