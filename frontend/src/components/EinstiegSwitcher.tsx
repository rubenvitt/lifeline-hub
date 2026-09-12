import { Button, Dropdown, Space, Typography, type MenuProps } from 'antd';
import { DownOutlined } from '@ant-design/icons';
import StatusTag from './StatusTag';
import type { StatusDarstellung } from '../theme/statusFarben';

export interface SwitcherEintrag {
  id: number;
  bezeichnung: string;
  darstellung: StatusDarstellung;
  /** Sortierrang — fachliche Reihenfolge des Moduls (aktiv zuerst …), bleibt beim Aufrufer. */
  rang: number;
}

interface Props {
  aktuell: { id: number; bezeichnung: string };
  eintraege: SwitcherEintrag[];
  onWechsel: (id: number) => void;
  neuLabel: string;
  onNeu: () => void;
}

/** Kopf-Switcher eines Orts-Moduls: aktueller Datensatz + Wechsel + Neuanlage
 *  (LFH-347 · M56, aus `pages/uhs/UhsSwitcher.tsx`). */
export default function EinstiegSwitcher({
  aktuell,
  eintraege,
  onWechsel,
  neuLabel,
  onNeu,
}: Props) {
  const sortiert = [...eintraege].sort(
    (a, b) => a.rang - b.rang || a.bezeichnung.localeCompare(b.bezeichnung, 'de'),
  );
  const items: MenuProps['items'] = [
    ...sortiert.map((e) => ({
      key: `eintrag-${e.id}`,
      label: (
        <Space>
          {e.bezeichnung}
          <StatusTag darstellung={e.darstellung} />
        </Space>
      ),
    })),
    { type: 'divider' as const },
    { key: 'neu', label: neuLabel },
  ];
  const onClick: MenuProps['onClick'] = ({ key }) => {
    if (key === 'neu') onNeu();
    else if (key.startsWith('eintrag-')) onWechsel(Number(key.slice('eintrag-'.length)));
  };
  return (
    <Dropdown menu={{ items, onClick }} trigger={['click']}>
      <Button type="text" style={{ padding: 0, height: 'auto' }}>
        <Typography.Text strong style={{ fontSize: 20 }}>
          {aktuell.bezeichnung} <DownOutlined style={{ fontSize: 14 }} />
        </Typography.Text>
      </Button>
    </Dropdown>
  );
}
