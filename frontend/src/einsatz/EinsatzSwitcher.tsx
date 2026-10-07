import { IconChevronRunter } from '../icons';
import { Button, Dropdown, theme, type MenuProps } from 'antd';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { listeEinsaetze } from '../api/einsaetze';
import { globalKeys } from '../api/queryKeys';
import { einsatzPfad } from '../routing/deeplinks';
import { farbenDunkel } from '../theme/tokens';
import type { EinsatzAnzeige } from '../api/types';
import { einsatzKennung } from './einsatzKennung';
import { useModusFarben } from '../components/rahmenStil';

/** Nebenzeile eines Eintrags: Einsatznummer und Ort, soweit vorhanden (LFH-954). */
function nebenzeile(e: EinsatzAnzeige): string | null {
  const teile = [einsatzKennung(e), e.einsatzort?.trim()].filter((t): t is string => !!t);
  return teile.length > 0 ? teile.join(' · ') : null;
}

/**
 * Switcher im Einsatz-Header: aktive Einsätze und der Weg zur Einsatzliste.
 *
 * Der eigene Einsatz ist gewählt markiert; ein Klick darauf schließt nur das Menü, statt aus dem
 * Modul auf die Startseite des Einsatzes zu werfen (LFH-954). Verwaltung steht hier nicht: sie
 * hat ihren Link im Kopf, mit Sperre für wen sie nicht freigegeben ist.
 *
 * DER NAME KÜRZT, statt die Kopfzeile zu schieben (LFH-329): ein antd-Knopf kürzt ohne eigenes
 * `overflow` nicht. Der volle Name bleibt am `title` lesbar und bleibt TEXTINHALT — in einem
 * `aria-label` kippte der zugängliche Name, an dem Tests und die Kommandopalette hängen.
 */
export default function EinsatzSwitcher({
  aktuellId,
  aktuellName,
}: {
  aktuellId: number;
  aktuellName: string;
}) {
  const navigate = useNavigate();
  const { token } = theme.useToken();
  // Das Menü folgt dem Modus, nicht dem dunklen Kopf: Farben aus den Rollen des Modus.
  const farben = useModusFarben();
  const { data: einsaetze = [] } = useQuery({
    queryKey: globalKeys.einsaetze(),
    queryFn: listeEinsaetze,
  });

  // Der eigene Einsatz steht immer darin, auch abgeschlossen: sonst fehlte die Markierung „hier
  // bin ich“ gerade dort, wo der Einsatz nur noch zum Nachlesen offen ist.
  const aktive = einsaetze.filter((e) => e.status === 'aktiv' || e.id === aktuellId);

  const eigenerKey = `einsatz-${aktuellId}`;
  const items: MenuProps['items'] = [
    ...aktive.map((e) => {
      const neben = nebenzeile(e);
      return {
        key: `einsatz-${e.id}`,
        label: neben ? (
          <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.3 }}>
            <span>{e.bezeichnung}</span>
            <span data-lfh="wechsler-nebenzeile" style={{ fontSize: 12, color: farben.gedaempft }}>
              {neben}
            </span>
          </span>
        ) : (
          e.bezeichnung
        ),
      };
    }),
    { type: 'divider' as const },
    { key: 'alle', label: 'Alle Einsätze …' },
  ];

  const onClick: MenuProps['onClick'] = ({ key }) => {
    if (key === 'alle') navigate('/einsaetze');
    // Der eigene Einsatz: antd schließt das Menü, die Seite bleibt.
    else if (key === eigenerKey) return;
    else if (key.startsWith('einsatz-')) {
      navigate(einsatzPfad(Number(key.slice('einsatz-'.length))));
    }
  };

  return (
    <Dropdown menu={{ items, onClick, selectedKeys: [eigenerKey] }} trigger={['click']}>
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
