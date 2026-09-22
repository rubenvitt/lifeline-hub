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
 * DIE INITIALEN STEHEN NEUTRAL (Neuentwurf „Instrumententafel", 21.09.2026): eine 24-px-
 * Kachel auf `flaeche3`, nicht mehr markenrot. Rot ist im Rahmen genau zweimal vergeben —
 * Logo-Quadrat und aktive Rail-Marke —, eine dritte rote Fläche daneben verwässerte beide.
 * Neben der Kachel steht ab `xl` die FUNKTION (`funktion`, z. B. „S2 Lage"), sonst der
 * Anzeigename. Die Funktion leitet das Backend ab (`EinsatzAnzeige.meine_funktion`,
 * LFH-615) — dieselbe Ableitung, die der ETB-Eintrag als Snapshot trägt; eine zweite im
 * Frontend könnte davon abweichen.
 *
 * ZWEI GESTALTEN, EINE SCHWELLE — die Schwelle gilt nur noch dem TRIGGER
 * (LFH-329 · B1/M12, eingeschränkt in LFH-392; seit 22.09.2026 `xl` statt `lg`, damit
 * der Kopf auf dem Führungs-Tablet einzeilig bleibt). Unterhalb von antds `xl`
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
export default function BenutzerMenu({ funktion }: { funktion?: string | null } = {}) {
  const { benutzer, logout } = useAuth();
  const navigate = useNavigate();
  const { token } = theme.useToken();
  // ALLE Hooks vor dem frühen Rückgabewert unten — sonst wechselt die
  // Hook-Reihenfolge, sobald der Benutzer eintrifft.
  const { abBreite } = useViewport();
  const { modus, setModus } = useThemeMode();
  const { dichte, setDichte } = useDichte();
  // Funktion und Pfeil erst ab `xl`: auf dem Führungs-Tablet (1024–1199 px) kosteten sie
  // bis zu 190 px und brachen die Kopfzeile auf zwei Zeilen (22.09.2026, gemessen 104 px).
  const breit = abBreite('xl');

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
          height: Math.max(40, token.controlHeight),
          minWidth: token.controlHeight,
          padding: `0 ${token.paddingXS}px`,
          color: rahmenFarben.gedaempft,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 9,
        }}
      >
        {/* Initialen-Kachel 24 px, quadratisch (Entwurf). Kein antd-`Avatar`: der trägt
            seine Farbe über `colorTextLightSolid`, und der Kopf ist in beiden Modi dunkel —
            die Kachel liest deshalb die Nachtrollen wie der übrige Rahmen. */}
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
        {/* Unter `xl` bleibt die Kachel allein stehen: Funktion und Pfeil kosten dort
            bis zu 190 px der Kopfzeile, und der Name steht ohnehin in der Kopfgruppe des
            Dropdowns. Das `aria-label` am Knopf bleibt, damit der Trigger auch als reines
            Symbol benannt ist. Höhe und Mindestbreite folgen der Dichte; 40 px bleiben nur
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
