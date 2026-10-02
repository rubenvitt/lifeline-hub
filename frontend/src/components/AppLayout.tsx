import { IconSchloss } from '../icons';
import { Layout, Tag, Typography, theme } from 'antd';
import type { CSSProperties } from 'react';
import { Link, Outlet } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import { darfVerwaltung } from '../einsatz/schreibrecht';
import { farbenDunkel, rahmenFarben } from '../theme/tokens';
import BenutzerMenu from './BenutzerMenu';
import CommandPaletteTrigger from './CommandPaletteTrigger';
import {
  KOPF_HOEHE,
  KopfRechts,
  Markenzelle,
  SyncAnzeige,
  Uhr,
  Wortmarke,
  kopfZelleStil,
} from './Kopfleiste';
import { useViewport } from './useViewport';

const { Header, Content } = Layout;

/**
 * Die Kommandoleiste der Ebene-1-Shell — dieselbe Gestalt wie im Einsatz-Workspace
 * (`einsatz/EinsatzLayout.tsx`): 52 px auf dem dunklen Rahmengrund, Haarlinie unten, Zellen
 * statt Abständen. Die Polsterung der Leiste selbst ist 0; die Kopf-Polsterung
 * (`--lfh-kopf-polsterung`) sitzt an der Suchzelle. Auf dem Handschirm bricht die rechte
 * Zellgruppe als GANZES um (LFH-460).
 */
const KOPF_STIL = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'stretch',
  height: 'auto',
  lineHeight: 'normal',
  minHeight: KOPF_HOEHE,
  padding: 0,
  background: rahmenFarben.grund,
  borderBottom: `1px solid ${rahmenFarben.linie}`,
  color: rahmenFarben.text,
} as const;

/**
 * Topbar-Eintrag: Link wenn frei, sonst gedämpft mit sichtbarem Grund (gesperrt statt versteckt).
 *
 * `grundSichtbar` kommt als PROP herein: die Breitenfrage stellt ausschließlich `useViewport`
 * im Elternteil (`useViewport.guard.test.ts`).
 */
function GlobalLink({
  to,
  label,
  gesperrt,
  grundSichtbar,
  linkStil,
}: {
  to: string;
  label: string;
  gesperrt: boolean;
  grundSichtbar: boolean;
  linkStil: CSSProperties;
}) {
  if (gesperrt) {
    return (
      <Typography.Text
        style={{
          // `rahmenFarben.gesperrt` hält den Boden 4,5 : 1 und bleibt sichtbar schwächer als der
          // freie Link (`gedaempft`). Die Tag-Schwelle gilt für bedienbaren Text, nicht für
          // Gesperrtes (LFH-434); deshalb steht das Schloss daneben.
          color: rahmenFarben.gesperrt,
          fontSize: 12,
          cursor: 'not-allowed',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          flexShrink: 0,
        }}
      >
        {/* Die Sperre trägt auf JEDER Breite ein Zeichen ohne Farbe (LFH-434, WCAG 1.4.1):
            `cursor: not-allowed` sieht auf Touch niemand, und der Tag steht erst ab `lg`. */}
        <span aria-hidden="true" data-lfh="sperr-schloss" style={{ display: 'inline-flex' }}>
          <IconSchloss size={13} />
        </span>
        {label}
        {/* Der Grund steht als TEXT da, nicht nur im `title`: auf dem Führungs-Tablet gibt es kein
            Hover. Eigene Farben, weil ein heller Standard-Tag auf dem dunklen Kopfzeilengrund den
            Kontrast verfehlte.

            ERST AB `lg` (LFH-337): der Block kann weder kürzen noch umbrechen (`flexShrink: 0` oben
            muss bleiben, sonst bräche der Tag INNERHALB der Kopfzeile um; antds `Tag` setzt
            `white-space: nowrap`) und sprengte bei 390 px die Kopfzeile. Das Führungs-Tablet liegt
            bei ≥ `lg` und behält seinen Grund. Der gedämpfte Link bleibt auf JEDER Breite stehen:
            „gesperrt statt versteckt" ist die Regel, nicht der Tag. */}
        {grundSichtbar && (
          <Tag
            style={{
              margin: 0,
              color: farbenDunkel.text,
              background: farbenDunkel.flaeche2,
              borderColor: farbenDunkel.linieStark,
            }}
          >
            Keine Berechtigung
          </Tag>
        )}
      </Typography.Text>
    );
  }
  return (
    <Link to={to} style={linkStil}>
      {label}
    </Link>
  );
}

export default function AppLayout() {
  const { benutzer } = useAuth();
  // Dieselbe Schwelle wie im Einsatz-Workspace. Sie trägt drei Fragen: ob der Sperrgrund als Tag
  // danebensteht, ob die Suche als Feld oder als Icon steht, und (ab `md`) ob die Uhr Platz hat.
  // Die Frage stellt ausschließlich `useViewport` (`useViewport.guard.test.ts`).
  const { abBreite } = useViewport();
  const breit = abBreite('lg');
  const mittel = abBreite('md');
  // Wie im Einsatz-Kopf: unter `xl` steht der Ruhezustand der SYNC-Anzeige nur als Icon.
  const weit = abBreite('xl');
  const { token } = theme.useToken();
  // Unter `md` rücken die Zellen zusammen: mit der vollen Staffel-Polsterung (18 px je Seite
  // in `komfortabel`) bräche die rechte Zellgruppe auf 390 px in eine dritte Zeile um.
  const zellToken = mittel ? token : { padding: token.paddingXS };
  // Der Verwaltungs-Link ist ein handgebautes Bedienziel: ZWEI Angaben (LFH-365). Farbe aus der
  // Nachtrolle, weil die Leiste in beiden Modi dunkel ist.
  const linkStil: CSSProperties = {
    color: rahmenFarben.gedaempft,
    fontSize: 12,
    display: 'inline-flex',
    alignItems: 'center',
    flexShrink: 0,
    minHeight: token.controlHeight,
    // Gate 3 misst Höhe UND Breite: ein 12-px-Wort allein fiele in `handschuh` unter 72.
    minWidth: token.controlHeight,
    justifyContent: 'center',
    padding: `${token.paddingXS}px 0`,
  };

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={KOPF_STIL}>
        {/* LINKE GRUPPE: Marke, Wortmarke (Link zur Einsatzliste), Verwaltung. */}
        <div style={{ display: 'flex', alignItems: 'stretch', flex: '1 1 auto', minWidth: 0 }}>
          <Markenzelle />
          <div style={kopfZelleStil(zellToken)}>
            <Wortmarke />
            <span
              aria-hidden="true"
              style={{ width: 1, height: 18, flexShrink: 0, background: rahmenFarben.linie }}
            />
            <GlobalLink
              to="/admin"
              label="Verwaltung"
              gesperrt={!darfVerwaltung(benutzer)}
              grundSichtbar={breit}
              linkStil={linkStil}
            />
          </div>
        </div>
        {/* SUCHZELLE ab `lg` — sie trägt die Kopf-Polsterung (`kopfpolsterung.guard.test.ts`).
            Farbschema und Bediendichte wohnen im Benutzermenü: Einstellungen gehören nicht in eine
            Aktionsreihe. */}
        {breit && (
          <div
            data-lfh="kopf-suche"
            style={{
              flex: '1 1 280px',
              minWidth: 0,
              display: 'flex',
              alignItems: 'center',
              paddingInline: 'var(--lfh-kopf-polsterung)',
            }}
          >
            <CommandPaletteTrigger />
          </div>
        )}
        <KopfRechts>
          {/* Außerhalb eines Einsatzes läuft kein Live-Strom — die SYNC-Zelle erscheint hier
              nur bei Netzverlust oder offener Offline-Queue. */}
          <SyncAnzeige liveErwartet={false} kompakt={!mittel} ruheOhneWort={!weit} />
          {mittel && <Uhr />}
          {!breit && (
            <div style={kopfZelleStil(zellToken)}>
              <CommandPaletteTrigger />
            </div>
          )}
          <div
            style={{ ...kopfZelleStil(zellToken, 'keiner'), paddingInlineStart: token.paddingXS }}
          >
            <BenutzerMenu />
          </div>
        </KopfRechts>
      </Header>
      <Content style={{ padding: 'var(--lfh-seiten-polsterung)' }}>
        <Outlet />
      </Content>
    </Layout>
  );
}
