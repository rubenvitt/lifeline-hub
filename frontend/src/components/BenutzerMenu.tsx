import {
  IconAbmelden,
  IconChevronRunter,
  IconDokumente,
  IconGlocke,
  IconPerson,
  IconPosteingang,
} from '../icons';
import {
  Avatar,
  Button,
  Dropdown,
  Space,
  Tag,
  Typography,
  theme,
  type DropdownProps,
  type MenuProps,
} from 'antd';
import type { KeyboardEvent } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { istUngelesen, useVersionsstand } from '../neuigkeiten/useVersionsstand';
import { NEUIGKEITEN_PFAD } from '../neuigkeiten/pfad';
import { BENACHRICHTIGUNGEN_PFAD, HILFE_PFAD, hilfePfad } from '../routing/deeplinks';
import { useAuth } from '../auth/AuthContext';
import { useAbmeldenRueckfrage } from '../auth/AbmeldenRueckfrage';
import { useDichte } from '../theme/ThemeModeProvider';
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
/**
 * Breite ab `md` im Handschuh-Betrieb (D12): fünf Helligkeitsstufen à 72 px plus Zielabstand
 * (2 × 8 px) brauchen 440 px; mit Polsterung des Menüs 480.
 */
const MENUE_BREITE_HANDSCHUH = 480;

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
function handleMenuKeyDown(e: KeyboardEvent<HTMLElement>) {
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
 * Funktion, darunter Profil, die Gruppe „Anzeige“ (LLH-1642), Benachrichtigungen, Neuigkeiten,
 * Hilfe und als letzter Eintrag Abmelden mit Rückfrage (LLH-1730, Spec `benutzermenue`; Rückmeldung
 * und Lizenzen stehen auf der Hilfe-Seite). Holt sich Benutzer und Rückfrage selbst, damit es in
 * beiden Layout-Ebenen gleich nutzbar ist.
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
 * Rail, Panel und Inhalt sprangen 52 px (CLS 0,556). Der längste Wortlaut ist nicht bekannt,
 * deshalb eine feste Breite.
 *
 * `hilfeDaneben` (im Einsatz-Kopf, LLH-1731 D4/D5): ab `lg` mit Maus öffnet „Hilfe“ in einem neuen Tab, in
 * der Desktop-App in einem Nebenfenster, und der Einsatz bleibt im ersten Tab mit seinen Alarmen.
 * Die Herkunft reist dann als `von` in der Adresse, weil ein neuer Tab den History-State nicht
 * erbt. Am Handy und am Tablet verdeckte ein zweiter Tab den Einsatz nur; dort bleibt es beim selben
 * Tab.
 *
 * `inNavigation` (LLH-1728, D3): am Handy steht der Auslöser im Fuß des Drawers „Navigation“ statt
 * im Kopf. Dann ist er eine volle Zeile mit Kachel und Name (oder Funktion) in den Farben der
 * Fläche, nicht des dunklen Rahmens, und das Menü öffnet nach oben. Das Menü selbst bleibt gleich.
 */
/**
 * Aus der Navigation darf das Menü seitlich ins Fenster rücken (`shiftX`, LLH-1728). antds Typ
 * `AdjustOverflow` kennt `shiftX` nicht, `getOverflowOptions` (`antd/es/_util/placements`)
 * übernimmt es aber aus jedem Objekt; e2e `rahmen-stehen-bleiben` belegt die Lage im Fenster.
 */
const INS_FENSTER = { adjustY: 1, shiftX: true } as unknown as DropdownProps['autoAdjustOverflow'];

export default function BenutzerMenu({
  funktion,
  hasFixedWidth = false,
  hilfeDaneben = false,
  inNavigation = false,
}: {
  funktion?: string | null;
  hasFixedWidth?: boolean;
  hilfeDaneben?: boolean;
  inNavigation?: boolean;
} = {}) {
  const { benutzer } = useAuth();
  const abmelden = useAbmeldenRueckfrage();
  const navigate = useNavigate();
  const location = useLocation();
  const { data: versionsstand } = useVersionsstand();
  const neuigkeitenUngelesen = istUngelesen(versionsstand);
  const { token } = theme.useToken();
  // ALLE Hooks vor dem frühen Rückgabewert unten — sonst wechselt die Hook-Reihenfolge, sobald
  // der Benutzer eintrifft.
  const { abBreite, istBeruehrung } = useViewport();
  // Handschuh (LLH-1642 D11): Kopf knapper — sonst läge am Handy unter dem zweizeiligen App-Kopf
  // die Leiste „Helligkeit“ unter dem Rand. Profil und Abmelden nebeneinander entfällt mit LLH-1730.
  const isKnapp = useDichte().dichte === 'handschuh';
  // Funktion und Pfeil erst ab `xl`: auf dem Führungs-Tablet brächen sie die Kopfzeile um.
  const breit = abBreite('xl');
  // Hilfe neben dem Einsatz nur am breiten Schirm mit Maus (LLH-1731 D4): unter `lg` Handy und
  // Tablet hochkant, mit grobem Zeiger das Führungs-Tablet quer (1024–1280 px). Dort verdeckte ein
  // zweiter Tab den Einsatz nur. Die Zeigerart, nicht die Breite, erkennt das Tablet (`useViewport`).
  const isHilfeImNeuenTab = hilfeDaneben && abBreite('lg') && !istBeruehrung;
  // Unter `md` (Handschirm) nimmt das Menü die Fensterbreite abzüglich 2 × 8 px Rand.
  const menueBreite = !abBreite('md')
    ? 'calc(100vw - 16px)'
    : isKnapp
      ? MENUE_BREITE_HANDSCHUH
      : MENUE_BREITE;

  if (!benutzer) return null;

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
          style={{
            display: 'flex',
            gap: token.margin,
            alignItems: 'flex-start',
            paddingBlock: token.paddingXS,
          }}
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
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                columnGap: 6,
                rowGap: token.marginXS,
              }}
            >
              <Typography.Text strong style={{ fontSize: 14, lineHeight: 1.3 }}>
                {benutzer.anzeigename}
              </Typography.Text>
              {isKnapp && rollenTags.length > 0 && (
                <Space size={token.marginXS} wrap>
                  {rollenTags}
                </Space>
              )}
            </div>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {isKnapp
                ? `@${benutzer.benutzername} · Version ${__APP_VERSION__}`
                : `@${benutzer.benutzername}`}
            </Typography.Text>
            {/* Die Funktion auf JEDER Breite (LFH-952, U89): am Auslöser steht sie erst ab `xl`, auf
                Tablet und Handy war sie sonst nirgends zu sehen. */}
            {funktion && (
              <Typography.Text
                data-lfh="benutzermenue-funktion"
                style={{ display: 'block', fontSize: 12, marginTop: token.marginXS }}
              >
                {funktion}
              </Typography.Text>
            )}
            {!isKnapp && rollenTags.length > 0 && (
              <div style={{ marginTop: 6 }}>
                <Space size={token.marginXS} wrap>
                  {rollenTags}
                </Space>
              </div>
            )}
            {!isKnapp && (
              <Typography.Text
                type="secondary"
                style={{ display: 'block', fontSize: 11, marginTop: 6 }}
              >
                Version {__APP_VERSION__}
              </Typography.Text>
            )}
          </div>
        </div>
      ),
    },
    // KEIN TRENNER ZWISCHEN KOPF UND PROFIL (LLH-1730, design.md D1): der Trenner vor „Abmelden“
    // kostete am Handy in `komfortabel` die letzten 5 px, „Abmelden“ ragte unter den Rand. Der Kopf
    // ist als Gruppe ohnehin abgesetzt.
    { key: 'profil', icon: <IconPerson />, label: 'Profil' },
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
                marginLeft: token.marginSM,
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
    // ZULETZT, DURCH EINEN TRENNER ABGESETZT (LLH-1730, Spec `benutzermenue`): direkt unter
    // „Profil“ (LFH-952) lag es im Griff, und ein Klick beendete die Sitzung sofort. Jetzt steht es
    // am Ende, wo man es sucht, und fragt zurück. Seit LLH-1642 passt das Menü am Handy in
    // `komfortabel` ganz ins Fenster; im Handschuh-Betrieb rollt es bis hierher.
    { type: 'divider' },
    { key: 'abmelden', icon: <IconAbmelden />, label: 'Abmelden', danger: true },
  ];

  const onClick: MenuProps['onClick'] = ({ key }) => {
    if (key === 'profil') navigate('/profil');
    else if (key === 'abmelden') abmelden.open();
    else if (key === 'hilfe' && isHilfeImNeuenTab) {
      window.open(hilfePfad({ von: location.pathname }), '_blank', 'noopener');
    } else if (key === 'hilfe') navigate(HILFE_PFAD, { state: { von: location.pathname } });
    else if (key === 'neuigkeiten') navigate(NEUIGKEITEN_PFAD);
    else if (key === 'benachrichtigungen') navigate(BENACHRICHTIGUNGEN_PFAD);
  };

  return (
    <>
      <Dropdown
        menu={{ items, onClick, onKeyDown: handleMenuKeyDown, style: { width: menueBreite } }}
        trigger={['click']}
        placement={inNavigation ? 'topLeft' : 'bottomRight'}
        // Aus der Navigation ist das Menü breiter als der Platz rechts vom Auslöser: es rückt in
        // das Fenster, statt rechts abgeschnitten zu stehen (LLH-1728).
        {...(inNavigation ? { autoAdjustOverflow: INS_FENSTER } : {})}
      >
        <Button
          type="text"
          aria-label="Benutzermenü"
          block={inNavigation}
          style={{
            // Im Kopf reichen 40 px als kompakter Boden (LFH-460); im Drawer am Handy hält die
            // Zeile den Boden der übrigen Drawer-Ziele, 48 px (Gate 3, `mitA1Boden`, LLH-1728).
            height: Math.max(inNavigation ? 48 : 40, token.controlHeight),
            minWidth: token.controlHeight,
            padding: `0 ${token.paddingXS}px`,
            color: inNavigation ? token.colorText : rahmenFarben.gedaempft,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: inNavigation ? 'flex-start' : undefined,
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
            `aria-label` benennt den Trigger. Höhe und Mindestbreite folgen der Dichte; der Höhenboden
            steht am `height` des Knopfs (LFH-460, im Drawer LLH-1728). */}
          {inNavigation && (
            <span
              style={{
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {funktion ?? benutzer.anzeigename}
            </span>
          )}
          {breit && !inNavigation && (
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
      {abmelden.dialog}
    </>
  );
}
