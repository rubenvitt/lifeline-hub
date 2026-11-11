import {
  IconAbmelden,
  IconChevronRunter,
  IconDokumente,
  IconGlocke,
  IconPerson,
  IconPosteingang,
} from '../icons';
import { Avatar, Button, Dropdown, Space, Tag, Typography, theme, type MenuProps } from 'antd';
import type { KeyboardEvent } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { istUngelesen, useVersionsstand } from '../neuigkeiten/useVersionsstand';
import { NEUIGKEITEN_PFAD } from '../neuigkeiten/pfad';
import { BENACHRICHTIGUNGEN_PFAD, HILFE_PFAD } from '../routing/deeplinks';
import { useAuth } from '../auth/AuthContext';
import { farbenDunkel, rahmenFarben, schrift } from '../theme/tokens';
import AnzeigeLeisten, { ANZEIGE_GRUPPE } from './AnzeigeLeisten';
import { useViewport } from './useViewport';

/** Initialen aus dem Anzeigenamen (erstes + letztes Wort, sonst erste zwei Zeichen). */
function initialen(name: string): string {
  const teile = name.trim().split(/\s+/).filter(Boolean);
  if (teile.length === 0) return '?';
  if (teile.length === 1) return teile[0].slice(0, 2).toUpperCase();
  return (teile[0][0] + teile[teile.length - 1][0]).toUpperCase();
}

/** Breite des geöffneten Menüs ab `md` (LLH-1642): die drei Leisten tragen ihre Wörter ganz. */
const MENUE_BREITE = 320;

/** Deckel des Etiketts am Trigger: längere Funktionen und Namen enden mit „…“. */
const ETIKETT_DECKEL = 180;

/**
 * Feste Breite des Etiketts mit `hasFixedWidth` (LLH-1272): „Einsatzleitung“ und gängige Namen
 * passen (75 px), Längeres endet mit „…“ und steht ganz im `title` und im Menükopf. Nicht der
 * Deckel: 180 px schoben die Umbruchkante des Kopfs in `komfortabel` über den Fükw (1366 px) und in
 * `kompakt` auf 1280 px; mit 120 px liegen sie bei ~1340 bzw. ~1220 px.
 */
const ETIKETT_PLATZ = 120;

/**
 * Tab im geöffneten Menü (LLH-1642 D2): `rc-menu` wandert mit den Pfeilen nur über `menuitem`s,
 * und `rc-dropdown` schließt beim zweiten Tab. Die Segmente der Gruppe „Anzeige“ wären so per
 * Tastatur unerreichbar. Deshalb führt Tab vom Menü in die Gruppe und darin von Leiste zu Leiste
 * (je das gewählte Segment, roving tabindex); Tab hinter der letzten Leiste und Umschalt+Tab vor der
 * ersten fallen an `rc-dropdown` durch und schließen das Menü wie bisher. Das Abfangen am `<ul>`
 * des Menüs reicht, weil React im Portal-Behälter lauscht und `stopPropagation` damit vor dem
 * `window`-Lauscher von `rc-dropdown` greift.
 */
function tabInsMenue(e: KeyboardEvent<HTMLElement>) {
  if (e.key !== 'Tab') return;
  const gruppe = e.currentTarget.querySelector<HTMLElement>(`[data-lfh="${ANZEIGE_GRUPPE}"]`);
  if (!gruppe) return;
  const halte = [...gruppe.querySelectorAll<HTMLElement>('[role="radio"][tabindex="0"]')];
  if (halte.length === 0) return;
  const jetzt = halte.indexOf(document.activeElement as HTMLElement);
  const ziel = jetzt === -1 ? (e.shiftKey ? halte.length - 1 : 0) : jetzt + (e.shiftKey ? -1 : 1);
  if (ziel < 0 || ziel >= halte.length) return;
  e.preventDefault();
  e.stopPropagation();
  halte[ziel]!.focus();
}

/**
 * Identitäts-Menü in der Topbar: Avatar + Name als Trigger, Dropdown mit Rollen-Übersicht und
 * Funktion, darunter sofort Profil und Abmelden, danach die Gruppe „Anzeige“ (LFH-952, LLH-1642),
 * Benachrichtigungen, Neuigkeiten und Hilfe (Spec `benutzermenue`; Rückmeldung und Lizenzen stehen
 * auf der Hilfe-Seite). Holt sich Benutzer und Logout selbst, damit es in beiden Layout-Ebenen
 * gleich nutzbar ist.
 *
 * DIE INITIALEN STEHEN NEUTRAL: eine 24-px-Kachel auf `flaeche3`. Rot ist im Rahmen genau
 * zweimal vergeben (Quadrat der Bildmarke, aktive Rail-Marke). Neben der Kachel steht ab `xl` die
 * FUNKTION (`funktion`, z. B. „S2 Lage"), sonst der Anzeigename. Die Funktion leitet das Backend
 * ab (`EinsatzAnzeige.meine_funktion`, LFH-615), dieselbe Ableitung wie im ETB-Snapshot.
 *
 * DIE SCHWELLE `xl` GILT NUR DEM TRIGGER: darunter schrumpft er auf den Avatar, damit der Kopf
 * auf dem Führungs-Tablet einzeilig bleibt. Die Gruppe „Anzeige“ hängt an KEINER Breite: sie ist
 * der einzige sichtbare Bedienweg mit aktivem Wert für Darstellung, Bediendichte und Helligkeit
 * (die Kommandopalette zeigt keinen an), und A1 weist Tablet und Handschirm `komfortabel` und
 * `handschuh` zu. Angebunden in {@link AnzeigeLeisten}, NICHT über die Kommandopalette: deren Hook
 * wirft außerhalb seines Providers, und der Test-Wrapper rendert keinen.
 *
 * `hasFixedWidth` (im Einsatz-Kopf, LLH-1272): das Etikett hält die Breite {@link ETIKETT_PLATZ},
 * statt sich nach dem Text zu richten. Die Funktion kommt erst mit dem Einsatz, davor steht der
 * Name, und an der Umbruchkante des Kopfs reichten 4 px Unterschied für eine zweite Kopfzeile:
 * Rail, Panel und Inhalt sprangen 52 px (CLS 0,556). Vorbild ist `WortPlatz` in `Kopfleiste.tsx`;
 * hier ist der längste Wortlaut nicht bekannt, deshalb eine feste Breite.
 */
export default function BenutzerMenu({
  funktion,
  hasFixedWidth = false,
}: { funktion?: string | null; hasFixedWidth?: boolean } = {}) {
  const { benutzer, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { data: versionsstand } = useVersionsstand();
  const neuigkeitenUngelesen = istUngelesen(versionsstand);
  const { token } = theme.useToken();
  // ALLE Hooks vor dem frühen Rückgabewert unten — sonst wechselt die Hook-Reihenfolge, sobald
  // der Benutzer eintrifft.
  const { abBreite } = useViewport();
  // Funktion und Pfeil erst ab `xl`: auf dem Führungs-Tablet brächen sie die Kopfzeile um.
  const breit = abBreite('xl');
  // Unter `md` (Handschirm) nimmt das Menü die Fensterbreite abzüglich 2 × 8 px Rand.
  const menueBreite = abBreite('md') ? MENUE_BREITE : 'calc(100vw - 16px)';

  if (!benutzer) return null;

  async function abmelden() {
    // `false`: die Sitzung gehört inzwischen einem anderen Benutzer (412, LFH-387) — der Server
    // hat sie nicht beendet, dieser Tab bleibt stehen und zeigt den Benutzerkonflikt.
    if (await logout()) navigate('/login', { replace: true });
  }

  const rollenTags = [];
  if (benutzer.system_rolle === 'admin') {
    rollenTags.push(
      <Tag key="admin" style={{ marginInlineEnd: 0 }}>
        Admin
      </Tag>,
    );
  }
  if (benutzer.org_rolle === 'fuehrungskraft') {
    rollenTags.push(
      <Tag key="fk" style={{ marginInlineEnd: 0 }}>
        Führungskraft
      </Tag>,
    );
  }

  const items: MenuProps['items'] = [
    {
      key: 'kopf',
      type: 'group',
      label: (
        <div
          data-testid="benutzermenue-kopf"
          style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '4px 0' }}
        >
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
            {/* Die Funktion auf JEDER Breite (LFH-952, U89): am Auslöser steht sie erst ab `xl`, auf
                Tablet und Handy war sie sonst nirgends zu sehen. */}
            {funktion && (
              <Typography.Text
                data-lfh="benutzermenue-funktion"
                style={{ display: 'block', fontSize: 12, marginTop: 4 }}
              >
                {funktion}
              </Typography.Text>
            )}
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
    // DIREKT UNTER DEM KOPF (LFH-952, U89): in `komfortabel` war das Menü 920 px hoch, am Handy
    // sichtbar 702 px — ganz unten lagen Profil und Abmelden unter dem Rand, beim Schichtwechsel
    // am geteilten Gerät. Rot steht durch den Trenner darunter abgesetzt.
    { type: 'divider' },
    { key: 'profil', icon: <IconPerson />, label: 'Profil' },
    { key: 'abmelden', icon: <IconAbmelden />, label: 'Abmelden', danger: true },
    // AUF JEDER BREITE (LFH-392, LLH-1642): die Kopfzeile ist die Aktionsreihe, eine Einstellung
    // gehört dort nicht hinein. Wer das an eine Breite hängt, nimmt allen drei Achsen ihren
    // einzigen sichtbaren Bedienweg mit aktivem Wert — die Palette zeigt keinen
    // (`command-palette/typen.ts` kennt kein Zustandsfeld). Inhalt eines Gruppentitels, kein
    // `menuitem`: eine Wahl schließt das Menü nicht.
    { type: 'divider' },
    { key: 'anzeige', type: 'group', label: <AnzeigeLeisten /> },
    { type: 'divider' },
    // Welche Hinweise kommen, stellt jede Person für sich ein (design.md D6).
    { key: 'benachrichtigungen', icon: <IconPosteingang />, label: 'Benachrichtigungen' },
    // Die Neuigkeiten mit einem Punkt, solange die laufende Version noch nicht gelesen ist (Spec
    // `neuigkeiten`). Der Punkt trägt den Zustand, nicht die Farbe allein: der Eintrag bleibt benannt.
    {
      key: 'neuigkeiten',
      icon: <IconGlocke />,
      label: (
        <span data-lfh="neuigkeiten-eintrag">
          Neuigkeiten
          {neuigkeitenUngelesen && (
            <span
              data-lfh="neuigkeiten-punkt"
              role="img"
              aria-label="ungelesen"
              style={{
                display: 'inline-block',
                width: 8,
                height: 8,
                marginLeft: 8,
                borderRadius: '50%',
                backgroundColor: token.colorPrimary,
                verticalAlign: 'middle',
              }}
            />
          )}
        </span>
      ),
    },
    // Hilfe (LFH-1096). Rückmeldung (LLH-1549) und Lizenzhinweis (LFH-1000) stehen seit LLH-1642
    // auf der Hilfe-Seite; die Hilfe bekommt den Pfad mit, aus dem sie geöffnet wurde, damit die
    // Rückmeldung dort den Bereich der App vorbefüllt (design.md D5).
    { key: 'hilfe', icon: <IconDokumente />, label: 'Hilfe' },
  ];

  const onClick: MenuProps['onClick'] = ({ key }) => {
    if (key === 'profil') navigate('/profil');
    else if (key === 'abmelden') void abmelden();
    else if (key === 'hilfe') navigate(HILFE_PFAD, { state: { von: location.pathname } });
    else if (key === 'neuigkeiten') navigate(NEUIGKEITEN_PFAD);
    else if (key === 'benachrichtigungen') navigate(BENACHRICHTIGUNGEN_PFAD);
  };

  return (
    <Dropdown
      menu={{ items, onClick, onKeyDown: tabInsMenue, style: { width: menueBreite } }}
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
              title={hasFixedWidth ? (funktion ?? benutzer.anzeigename) : undefined}
              style={{
                // `inline-block`: antd hüllt die Kinder des Knopfs in ein Inline-`span`, eine
                // Breite griffe sonst nicht. Mit `overflow: hidden` läge seine Grundlinie an der
                // Unterkante; `middle` hält den Text auf der Höhe des Pfeils.
                display: 'inline-block',
                verticalAlign: 'middle',
                width: hasFixedWidth ? ETIKETT_PLATZ : undefined,
                maxWidth: hasFixedWidth ? ETIKETT_PLATZ : ETIKETT_DECKEL,
                textAlign: 'start',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontSize: 12,
              }}
            >
              {funktion ?? benutzer.anzeigename}
            </span>
            <IconChevronRunter style={{ fontSize: 10, opacity: 0.65 }} />
          </>
        )}
      </Button>
    </Dropdown>
  );
}
