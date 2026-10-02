import { IconChevronRunter } from '../icons';
import { Button, Dropdown, theme, type MenuProps } from 'antd';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { listeEinsaetze } from '../api/einsaetze';
import { globalKeys } from '../api/queryKeys';
import { einsatzPfad } from '../routing/deeplinks';
import { farbenDunkel } from '../theme/tokens';

/**
 * Switcher im Einsatz-Header: aktive Einsätze + Rückwege.
 *
 * DER NAME KÜRZT, statt die Kopfzeile zu schieben (LFH-329): ein antd-Knopf kürzt ohne eigenes
 * `overflow` nicht. Der volle Name bleibt am `title` lesbar und bleibt TEXTINHALT — in einem
 * `aria-label` kippte der zugängliche Name, an dem Tests und die Kommandopalette hängen.
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
        // Farbe aus der NACHTrolle, nicht der Modus-Token: die Kommandoleiste ist in beiden Modi dunkel.
        style={{
          color: farbenDunkel.text2,
          fontWeight: 500,
          fontSize: 13,
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
        <IconChevronRunter style={{ flexShrink: 0 }} />
      </Button>
    </Dropdown>
  );
}
