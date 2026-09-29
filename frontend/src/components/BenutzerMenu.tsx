import { Avatar, Button, Dropdown, Space, Tag, Typography, theme, type MenuProps } from 'antd';
import { DownOutlined, LogoutOutlined, UserOutlined } from '@ant-design/icons';
import type { IconType } from 'react-icons';
import { useNavigate } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import { useDichte, useThemeMode, type ThemeModus } from '../theme/ThemeModeProvider';
import { farbenDunkel, rahmenFarben, schrift, type Dichte } from '../theme/tokens';
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
 * Beschriftung eines Umschalt-Eintrags. Die aktive Stufe trägt ihren Zustand im TEXT — zweiter
 * Kanal nach WCAG 1.4.1 und über den zugänglichen Namen prüfbar.
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
 * Identitäts-Menü in der Topbar: Avatar + Name als Trigger, Dropdown mit Rollen-Übersicht,
 * Profil und Abmelden. Holt sich Benutzer und Logout selbst, damit es in beiden Layout-Ebenen
 * gleich nutzbar ist.
 *
 * DIE INITIALEN STEHEN NEUTRAL: eine 24-px-Kachel auf `flaeche3`. Rot ist im Rahmen genau
 * zweimal vergeben (Logo-Quadrat, aktive Rail-Marke). Neben der Kachel steht ab `xl` die
 * FUNKTION (`funktion`, z. B. „S2 Lage"), sonst der Anzeigename. Die Funktion leitet das Backend
 * ab (`EinsatzAnzeige.meine_funktion`, LFH-615), dieselbe Ableitung wie im ETB-Snapshot.
 *
 * DIE SCHWELLE `xl` GILT NUR DEM TRIGGER: darunter schrumpft er auf den Avatar, damit der Kopf
 * auf dem Führungs-Tablet einzeilig bleibt. Die zwei Umschaltgruppen hängen an KEINER Breite:
 * sie sind der einzige sichtbare Bedienweg für Darstellung und Bediendichte (die
 * Kommandopalette zeigt keinen aktiven Wert an), und A1 weist Tablet und Handschirm
 * `komfortabel` und `handschuh` zu.
 *
 * Angebunden über `useThemeMode`/`useDichte`, NICHT über die Kommandopalette: deren Hook wirft
 * außerhalb seines Providers, und der Test-Wrapper rendert keinen.
 */
export default function BenutzerMenu({ funktion }: { funktion?: string | null } = {}) {
  const { benutzer, logout } = useAuth();
  const navigate = useNavigate();
  const { token } = theme.useToken();
  // ALLE Hooks vor dem frühen Rückgabewert unten — sonst wechselt die Hook-Reihenfolge, sobald
  // der Benutzer eintrifft.
  const { abBreite } = useViewport();
  const { modus, setModus } = useThemeMode();
  const { dichte, setDichte } = useDichte();
  // Funktion und Pfeil erst ab `xl`: auf dem Führungs-Tablet brächen sie die Kopfzeile um.
  const breit = abBreite('xl');

  if (!benutzer) return null;

  async function abmelden() {
    // `false`: die Sitzung gehört inzwischen einem anderen Benutzer (412, LFH-387) — der Server
    // hat sie nicht beendet, dieser Tab bleibt stehen und zeigt den Benutzerkonflikt.
    if (await logout()) navigate('/login', { replace: true });
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
          <Avatar
            shape="square"
            style={{
              backgroundColor: token.colorFillSecondary,
              color: token.colorText,
              fontFamily: token.fontFamilyCode,
              flexShrink: 0,
            }}
          >
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
    // AUF JEDER BREITE (LFH-392): die Kopfzeile ist die Aktionsreihe, eine Einstellung gehört dort
    // nicht hinein. Wer das an eine Breite hängt, nimmt beiden Achsen ihren einzigen sichtbaren
    // Bedienweg — die Palette zeigt keinen aktiven Wert (`command-palette/typen.ts` kennt kein
    // Zustandsfeld).
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
          height: Math.max(40, token.controlHeight),
          minWidth: token.controlHeight,
          padding: `0 ${token.paddingXS}px`,
          color: rahmenFarben.gedaempft,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 9,
        }}
      >
        {/* Initialen-Kachel 24 px, quadratisch. Kein antd-`Avatar`: der färbt über
            `colorTextLightSolid`, der Kopf ist aber in beiden Modi dunkel — die Kachel liest die
            Nachtrollen wie der übrige Rahmen. */}
        <span
          style={{
            width: 24,
            height: 24,
            flexShrink: 0,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: rahmenFarben.aktiv,
            color: farbenDunkel.text2,
            fontFamily: schrift.zahl,
            fontSize: 10,
          }}
        >
          {initialen(benutzer.anzeigename)}
        </span>
        {/* Unter `xl` bleibt die Kachel allein; der Name steht in der Kopfgruppe des Dropdowns, das
            `aria-label` benennt den Trigger. Höhe und Mindestbreite folgen der Dichte; 40 px sind nur
            der kompakte Höhenboden (LFH-460). */}
        {breit && (
          <>
            <span
              style={{
                maxWidth: 180,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontSize: 12,
              }}
            >
              {funktion ?? benutzer.anzeigename}
            </span>
            <DownOutlined aria-hidden style={{ fontSize: 10, opacity: 0.65 }} />
          </>
        )}
      </Button>
    </Dropdown>
  );
}
