import { Button, Dropdown, theme, type MenuProps } from 'antd';
import { DownOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { listeEinsaetze } from '../api/einsaetze';
import { globalKeys } from '../api/queryKeys';
import { einsatzPfad } from '../routing/deeplinks';

/**
 * Switcher im Einsatz-Header: aktive Einsätze + Rückwege.
 *
 * DER NAME KÜRZT, statt die Kopfzeile zu schieben (LFH-329 · B1/M12). Der
 * Restbreiten-Rahmen im `EinsatzLayout` allein reicht dafür nicht: der Name
 * sitzt in einem antd-Knopf, und der kürzt ohne eigenes `overflow` nicht. Der
 * volle Name bleibt am `title` lesbar — und er bleibt TEXTINHALT: verschöbe man
 * ihn in ein `aria-label`, kippte der zugängliche Name des Knopfs, an dem
 * mehrere Tests und die Kommandopalette hängen.
 */
export default function EinsatzSwitcher({ aktuellName }: { aktuellName: string }) {
  const navigate = useNavigate();
  const { token } = theme.useToken();
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
    else if (key.startsWith('einsatz-')) {
      navigate(einsatzPfad(Number(key.slice('einsatz-'.length))));
    }
  };

  return (
    <Dropdown menu={{ items, onClick }} trigger={['click']}>
      <Button
        type="text"
        title={aktuellName}
        style={{
          color: '#fff',
          fontWeight: 600,
          fontSize: 16,
          maxWidth: '100%',
          // Auch ein kurzer Name wie „A“ hält den Handschuh-Boden (LFH-460).
          minWidth: token.controlHeight,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {aktuellName}
        </span>
        {/* Eigenes Geschwister und nicht schrumpfend: der Pfeil ist das Signal
            „hier lässt sich wechseln" und darf als Erstes nicht verschwinden. */}
        <DownOutlined style={{ flexShrink: 0 }} />
      </Button>
    </Dropdown>
  );
}
