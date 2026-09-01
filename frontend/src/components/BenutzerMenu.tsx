import { Avatar, Button, Dropdown, Space, Tag, Typography, theme, type MenuProps } from 'antd';
import { DownOutlined, LogoutOutlined, UserOutlined } from '@ant-design/icons';
import type { IconType } from 'react-icons';
import { useNavigate } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import { rollenFarbe } from '../theme/statusFarben';
import { useDichte, useThemeMode, type ThemeModus } from '../theme/ThemeModeProvider';
import type { Dichte } from '../theme/tokens';
import { DARSTELLUNG_OPTIONEN, DICHTE_OPTIONEN } from '../theme/darstellungOptionen';
import { useViewport } from './useViewport';

/** Initialen aus dem Anzeigenamen (erstes + letztes Wort, sonst erste zwei Zeichen). */
function initialen(name: string): string {
  const teile = name.trim().split(/\s+/).filter(Boolean);
  if (teile.length === 0) return '?';
  if (teile.length === 1) return teile[0].slice(0, 2).toUpperCase();
  return (teile[0][0] + teile[teile.length - 1][0]).toUpperCase();
}

/** Präfixe der beiden Umschalt-Gruppen. Sie tragen den Wert im Schlüssel,
 *  damit `onClick` ohne zweite Zuordnungstabelle auskommt. */
const DARSTELLUNG_PRAEFIX = 'darstellung:';
const DICHTE_PRAEFIX = 'stufe:';

/**
 * Beschriftung eines Umschalt-Eintrags. Die aktive Stufe trägt ihren Zustand im
 * TEXT, nicht nur in der Auswahlfarbe — zweiter Kanal nach WCAG 1.4.1, und
 * zugleich das Einzige, was im Test über den zugänglichen Namen prüfbar ist.
 */
function umschaltEintrag(
  praefix: string,
  wert: string,
  titel: string,
  Icon: IconType,
  aktiv: boolean,
) {
  return {
    key: `${praefix}${wert}`,
    icon: <Icon size={16} />,
    label: aktiv ? `${titel} ✓` : titel,
  };
}

/**
 * Identitäts-Menü in der Topbar: Avatar + Name als Trigger, Dropdown mit
 * Rollen-Übersicht, Profil und Abmelden. Holt sich Benutzer und Logout selbst,
 * damit es in beiden Layout-Ebenen (global + Einsatz-Workspace) gleich nutzbar ist.
 *
 * Der Avatar trägt die MARKENFARBE (LFH-328/A2, Spec §1.2) — er ist das Markenzeichen im
 * Kopf, keine Gefahrenmeldung. Sie kommt über `rollenFarbe('marke', token)` und damit je
 * Modus aus `theme/tokens.ts`; vorher stand hier eine Kopie des Hex-Werts.
 *
 * ZWEI GESTALTEN, EINE SCHWELLE — die Schwelle gilt nur noch dem TRIGGER
 * (LFH-329 · B1/M12, eingeschränkt in LFH-392). Unterhalb von antds `lg`
 * schrumpft der Auslöser auf den Avatar (kein Name, kein Pfeil). Die zwei
 * Umschaltgruppen im Dropdown hängen dagegen an KEINER Breite mehr: seit
 * LFH-392 ist dies der einzige sichtbare Bedienweg für Darstellung und
 * Bediendichte, auf jedem Schirm.
 *
 * Die Kommandopalette trägt beide Achsen zwar als sechs Befehle, ersetzt diese
 * Gruppen aber nicht: sie zeigt keinen aktiven Wert an. Ohne sie wären genau die
 * Stufen unbedienbar, die A1 dem Führungs-Tablet und dem mobilen Kontext
 * zuweist: `komfortabel` und `handschuh`.
 *
 * Angebunden wird über `useThemeMode`/`useDichte`, NICHT über die
 * Kommandopalette: deren Hook wirft außerhalb seines Providers, und der
 * Test-Wrapper rendert keinen — ein Zugriff darüber risse die Layout-Suiten mit.
 */
export default function BenutzerMenu() {
  const { benutzer, logout } = useAuth();
  const navigate = useNavigate();
  const { token } = theme.useToken();
  const avatarFarbe = rollenFarbe('marke', token);
  // ALLE Hooks vor dem frühen Rückgabewert unten — sonst wechselt die
  // Hook-Reihenfolge, sobald der Benutzer eintrifft.
  const { abBreite } = useViewport();
  const { modus, setModus } = useThemeMode();
  const { dichte, setDichte } = useDichte();
  const breit = abBreite('lg');

  if (!benutzer) return null;

  async function abmelden() {
    await logout();
    navigate('/login', { replace: true });
  }

  const rollenTags = [];
  if (benutzer.system_rolle === 'admin') {
    rollenTags.push(
      <Tag key="admin" color="gold" style={{ marginInlineEnd: 0 }}>
        Admin
      </Tag>,
    );
  }
  if (benutzer.org_rolle === 'fuehrungskraft') {
    rollenTags.push(
      <Tag key="fk" color="blue" style={{ marginInlineEnd: 0 }}>
        Führungskraft
      </Tag>,
    );
  }

  const items: MenuProps['items'] = [
    {
      key: 'kopf',
      type: 'group',
      label: (
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '4px 0' }}>
          <Avatar style={{ backgroundColor: avatarFarbe, color: '#fff', flexShrink: 0 }}>
            {initialen(benutzer.anzeigename)}
          </Avatar>
          <div style={{ minWidth: 0 }}>
            <Typography.Text strong style={{ display: 'block', fontSize: 14, lineHeight: 1.3 }}>
              {benutzer.anzeigename}
            </Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              @{benutzer.benutzername}
            </Typography.Text>
            {rollenTags.length > 0 && (
              <div style={{ marginTop: 6 }}>
                <Space size={4} wrap>
                  {rollenTags}
                </Space>
              </div>
            )}
            <Typography.Text
              type="secondary"
              style={{ display: 'block', fontSize: 11, marginTop: 6 }}
            >
              Version {__APP_VERSION__}
            </Typography.Text>
          </div>
        </div>
      ),
    },
    // AUF JEDER BREITE (LFH-392). Bis dahin hing das an `breit ? [] : […]`, weil
    // ab `lg` zwei Segmentleisten in der Kopfzeile dieselbe Wahl trugen — und
    // zwei Bedienwege mit getrenntem Aussehen für eine Wahl sind schlechter als
    // einer. Der Satz gilt weiter; aufgelöst ist er jetzt zugunsten DIESER
    // Stelle: die Kopfzeile ist die Aktionsreihe, und eine Einstellung gehört da
    // nicht hinein.
    //
    // WER DEN RIEGEL ZURÜCKDREHT, nimmt beiden Achsen ab 992 px ihren einzigen
    // sichtbaren Bedienweg: die Kommandopalette trägt sie zwar als sechs Befehle,
    // zeigt aber keinen aktiven Wert an (`command-palette/typen.ts` kennt kein
    // Zustandsfeld) — der zweite Kanal nach WCAG 1.4.1 hinge dann an nichts.
    { type: 'divider' },
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
    { type: 'divider' },
    { key: 'profil', icon: <UserOutlined />, label: 'Profil' },
    { key: 'abmelden', icon: <LogoutOutlined />, label: 'Abmelden', danger: true },
  ];

  const onClick: MenuProps['onClick'] = ({ key }) => {
    if (key === 'profil') navigate('/profil');
    else if (key === 'abmelden') void abmelden();
    else if (key.startsWith(DARSTELLUNG_PRAEFIX))
      setModus(key.slice(DARSTELLUNG_PRAEFIX.length) as ThemeModus);
    else if (key.startsWith(DICHTE_PRAEFIX)) setDichte(key.slice(DICHTE_PRAEFIX.length) as Dichte);
  };

  return (
    <Dropdown
      menu={{ items, onClick, style: { minWidth: 240 } }}
      trigger={['click']}
      placement="bottomRight"
    >
      <Button
        type="text"
        aria-label="Benutzermenü"
        style={{
          height: 40,
          padding: '0 8px',
          color: '#fff',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <Avatar
          size={28}
          style={{ backgroundColor: avatarFarbe, color: '#fff', fontSize: 13, flexShrink: 0 }}
        >
          {initialen(benutzer.anzeigename)}
        </Avatar>
        {/* Unter `lg` bleibt der Avatar allein stehen: Name und Pfeil kosten
            dort bis zu 190 px der Kopfzeile, und der Name steht ohnehin in der
            Kopfgruppe des Dropdowns. Das `aria-label` am Knopf bleibt, damit
            der Trigger auch als reines Symbol benannt ist — die Höhe (40 px)
            hält dabei A1 Gate 3 (≥ 24 px) mit Reserve. */}
        {breit && (
          <>
            <span
              style={{
                maxWidth: 180,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {benutzer.anzeigename}
            </span>
            <DownOutlined style={{ fontSize: 10, opacity: 0.65 }} />
          </>
        )}
      </Button>
    </Dropdown>
  );
}
