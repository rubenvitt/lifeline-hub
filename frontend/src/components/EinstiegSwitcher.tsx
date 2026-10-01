import { IkoneChevronRunter } from '../ikonen';
import { Button, Dropdown, Space, theme, Typography, type MenuProps } from 'antd';
import StatusTag from './StatusTag';
import type { StatusDarstellung } from '../theme/statusFarben';

interface SwitcherEintrag {
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

/**
 * Stil des Wechslers — rein und exportiert (Muster `bedienzielStil`). Er sieht aus wie der
 * Seitentitel (kein Innenabstand, Höhe folgt der 20-px-Schrift) und ist trotzdem ein
 * Bedienziel: `minHeight` hält die Steuerhöhe der Stufe (LFH-724; ohne sie maß er in
 * `handschuh` 33 px).
 */
export function wechslerStil(token: { controlHeight: number }) {
  return { padding: 0, height: 'auto', minHeight: token.controlHeight } as const;
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
  const { token } = theme.useToken();
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
      <Button type="text" style={wechslerStil(token)}>
        <Typography.Text strong style={{ fontSize: 20 }}>
          {aktuell.bezeichnung} <IkoneChevronRunter style={{ fontSize: 14 }} />
        </Typography.Text>
      </Button>
    </Dropdown>
  );
}
