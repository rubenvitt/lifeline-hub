import { useState } from 'react';
import { Button, Dropdown, Modal, theme, type MenuProps } from 'antd';
import { useNavigate } from 'react-router';
import { IconAbmelden, IconMenue, type Icon } from '../icons';
import { useAuth } from '../auth/AuthContext';
import {
  useDichte,
  useHelligkeit,
  useThemeMode,
  type ThemeModus,
} from '../theme/ThemeModeProvider';
import { rahmenFarben, type Dichte } from '../theme/tokens';
import {
  DARSTELLUNG_OPTIONEN,
  DICHTE_OPTIONEN,
  HELLIGKEIT_OPTIONEN,
} from '../theme/darstellungOptionen';
import { HELLIGKEIT_BODEN_WARNUNG, alsHelligkeit } from '../theme/helligkeit';
import { KOPPELN_PFAD } from '../routing/deeplinks';

const DARSTELLUNG_PRAEFIX = 'darstellung:';
const DICHTE_PRAEFIX = 'stufe:';
const HELLIGKEIT_PRAEFIX = 'helligkeit:';

/** Wie im Benutzermenü: die aktive Stufe trägt ihren Zustand im Text (WCAG 1.4.1). */
function umschaltEintrag(praefix: string, wert: string, titel: string, Icon: Icon, aktiv: boolean) {
  return {
    key: `${praefix}${wert}`,
    icon: <Icon size={16} />,
    label: aktiv ? `${titel} ✓` : titel,
  };
}

/**
 * Gerätemenü der Hülle (LFH-892, design.md D9) an der Stelle des Benutzermenüs: Darstellung,
 * Bediendichte (auch Handschuh, gespeichert am Gerät, Spec `feldgeraet-bedienung`), Helligkeit
 * und „Gerät abmelden“. Kein Profil: ein Gerät ist keine Person.
 *
 * „Gerät abmelden“ beendet die Sitzung; zurück kommt das Gerät nur mit einem neuen Code der
 * Einsatzleitung. Für die Bedienung am Gerät ist das unumkehrbar und fragt deshalb zurück
 * (LFH-363).
 */
export function GeraeteMenue() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const { token } = theme.useToken();
  const { modus, setModus } = useThemeMode();
  const { dichte, setDichte } = useDichte();
  const { helligkeit, setHelligkeit, wirksam, warnungAktiv } = useHelligkeit();
  const [abmeldenOffen, setAbmeldenOffen] = useState(false);
  const [meldetAb, setMeldetAb] = useState(false);

  async function abmelden() {
    setMeldetAb(true);
    try {
      // `false`: die Sitzung gehört inzwischen jemand anderem (412, LFH-387); dann bleibt es.
      if (await logout()) navigate(KOPPELN_PFAD, { replace: true });
    } finally {
      setMeldetAb(false);
      setAbmeldenOffen(false);
    }
  }

  const items: MenuProps['items'] = [
    {
      key: 'darstellung',
      type: 'group',
      label: 'Darstellung',
      children: DARSTELLUNG_OPTIONEN.map(({ wert, titel, Icon }) =>
        umschaltEintrag(DARSTELLUNG_PRAEFIX, wert, titel, Icon, wert === modus),
      ),
    },
    {
      key: 'bediendichte',
      type: 'group',
      label: 'Bediendichte',
      children: DICHTE_OPTIONEN.map(({ wert, titel, Icon }) =>
        umschaltEintrag(DICHTE_PRAEFIX, wert, titel, Icon, wert === dichte),
      ),
    },
    {
      key: 'helligkeit',
      type: 'group',
      label: warnungAktiv
        ? `Helligkeit · mind. ${HELLIGKEIT_BODEN_WARNUNG} % (Warnung aktiv)`
        : 'Helligkeit',
      children: HELLIGKEIT_OPTIONEN.map(({ wert, titel, Icon }) => {
        const eintrag = umschaltEintrag(
          HELLIGKEIT_PRAEFIX,
          String(wert),
          titel,
          Icon,
          wert === helligkeit,
        );
        return {
          ...eintrag,
          label:
            wert === helligkeit && wirksam !== wert
              ? `${eintrag.label} (wirkt ${wirksam} %)`
              : eintrag.label,
          disabled: warnungAktiv && wert < HELLIGKEIT_BODEN_WARNUNG,
        };
      }),
    },
    { type: 'divider' },
    { key: 'abmelden', icon: <IconAbmelden />, label: 'Gerät abmelden …', danger: true },
  ];

  const onClick: MenuProps['onClick'] = ({ key }) => {
    if (key === 'abmelden') setAbmeldenOffen(true);
    else if (key.startsWith(DARSTELLUNG_PRAEFIX))
      setModus(key.slice(DARSTELLUNG_PRAEFIX.length) as ThemeModus);
    else if (key.startsWith(DICHTE_PRAEFIX)) setDichte(key.slice(DICHTE_PRAEFIX.length) as Dichte);
    else if (key.startsWith(HELLIGKEIT_PRAEFIX))
      setHelligkeit(alsHelligkeit(key.slice(HELLIGKEIT_PRAEFIX.length)));
  };

  return (
    <>
      <Dropdown
        menu={{ items, onClick, style: { minWidth: 240 } }}
        trigger={['click']}
        placement="bottomRight"
      >
        <Button
          type="text"
          aria-label="Gerätemenü"
          icon={<IconMenue size={20} />}
          style={{
            height: Math.max(40, token.controlHeight),
            minWidth: token.controlHeight,
            color: rahmenFarben.gedaempft,
          }}
        />
      </Dropdown>
      <Modal
        open={abmeldenOffen}
        title="Gerät abmelden?"
        okText="Abmelden"
        cancelText="Abbrechen"
        okButtonProps={{ danger: true, loading: meldetAb }}
        onOk={() => void abmelden()}
        onCancel={() => setAbmeldenOffen(false)}
        destroyOnHidden
      >
        <p>
          Das Gerät verlässt den Einsatz. Wieder koppeln lässt es sich nur mit einem neuen Code der
          Einsatzleitung.
        </p>
      </Modal>
    </>
  );
}
