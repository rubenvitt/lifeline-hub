import { Button, Dropdown, type MenuProps } from 'antd';
import { DownOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { listeEinsaetze } from '../api/einsaetze';
import { globalKeys } from '../api/queryKeys';

/** Switcher im Einsatz-Header: aktive Einsätze + Rückwege. */
export default function EinsatzSwitcher({ aktuellName }: { aktuellName: string }) {
  const navigate = useNavigate();
  const { data: einsaetze = [] } = useQuery({
    queryKey: globalKeys.einsaetze(),
    queryFn: listeEinsaetze,
  });

  const aktive = einsaetze.filter((e) => e.status === 'aktiv');

  const items: MenuProps['items'] = [
    ...aktive.map((e) => ({ key: `einsatz-${e.id}`, label: e.bezeichnung })),
    { type: 'divider' as const },
    { key: 'alle', label: 'Alle Einsätze …' },
    { key: 'stammdaten', label: 'Stammdaten' },
  ];

  const onClick: MenuProps['onClick'] = ({ key }) => {
    if (key === 'alle') navigate('/einsaetze');
    else if (key === 'stammdaten') navigate('/stammdaten');
    else if (key.startsWith('einsatz-')) navigate(`/einsaetze/${key.slice('einsatz-'.length)}`);
  };

  return (
    <Dropdown menu={{ items, onClick }} trigger={['click']}>
      <Button type="text" style={{ color: '#fff', fontWeight: 600, fontSize: 16 }}>
        {aktuellName} <DownOutlined />
      </Button>
    </Dropdown>
  );
}
