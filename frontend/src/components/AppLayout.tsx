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
 * (`einsatz/EinsatzLayout.tsx`, Neuentwurf „Instrumententafel"): 52 px auf dem dunklen
 * Rahmengrund, Haarlinie unten, Zellen statt Abständen. Die Polsterung der Leiste selbst
 * ist 0; die Kopf-Polsterung (`--lfh-kopf-polsterung`, LFH-329 · B1/M12) sitzt an der
 * Suchzelle. Auf dem Handschirm bricht die rechte Zellgruppe als GANZES um (LFH-460).
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
 * `grundSichtbar` kommt als PROP herein und wird hier NICHT selbst erfragt: die Breitenfrage
 * stellt ausschließlich `useViewport` im Elternteil (erzwungen von
 * `useViewport.guard.test.ts`) — eine zweite, handgeschriebene Abfrage driftet still von
 * antds Schwellen weg.
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
          // Farbrolle statt des abgelösten `rgba(255, 255, 255, 0.35)` (Befund M10): der
          // Hartwert erreichte gegen den Kopfzeilengrund #001529 nur ~3,2:1 und verfehlte
          // WCAG 1.4.3. `farbenDunkel.schwach` liefert gerechnete 5,3:1 und bleibt dabei
          // deutlich schwächer als der weiße Aktiv-Link — die Sperre bleibt ablesbar.
          // `farbenDunkel`, nicht der modusabhängige Token: die Kopfzeile trägt in BEIDEN
          // Modi denselben dunklen Grund (dieselbe Begründung wie `IconRail.tsx:20-21`).
          color: farbenDunkel.schwach,
          fontSize: 12,
          cursor: 'not-allowed',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          flexShrink: 0,
        }}
      >
        {label}
        {/* Der Grund steht als TEXT da, nicht mehr nur im `title` — auf dem
            Führungs-Tablet gibt es kein Hover, dort war er bis hierher unsichtbar.
            Damit entfällt zugleich die Schloss-Ikone: sie sagte dasselbe, nur
            unbeschriftet, und der `title` als einzige Begründung ist genau der Befund.
            Eigene Farben statt der antd-Vorgabe, weil ein heller Standard-Tag auf dem
            dunklen Kopfzeilengrund seinerseits den Kontrast verfehlte.

            ERST AB `lg` (LFH-337 · Fix-Welle): der Block kann weder kürzen noch
            umbrechen — `flexShrink: 0` oben sperrt das Kürzen (und muss bleiben, sonst
            bräche der Tag INNERHALB der Kopfzeile um), antds `Tag` setzt
            `white-space: nowrap`. Auf 390 px verlangte die Kopfzeile damit gemessen
            rund 458 px bei 366 px nutzbarer Breite. Das Führungs-Tablet liegt bei
            1024–1280 px, also ≥ `lg` — der „kein Hover"-Fall, für den der sichtbare
            Grund gebaut wurde, behält dort seinen Grund. Nur der 390-px-Kontext
            verliert ihn wieder, und dessen Kopfzeilenbudget ist eine bewirtschaftete
            Größe (LFH-329 · B1). Der gedämpfte Link selbst bleibt auf JEDER Breite
            stehen: „gesperrt statt versteckt" ist die Regel, nicht der Tag. */}
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
  // Dieselbe Schwelle wie im Einsatz-Workspace. Sie trägt drei Fragen: ob der Sperrgrund
  // am Verwaltungs-Link als Tag danebensteht, ob die Suche als Feld oder als Ikone steht,
  // und (ab `md`) ob die Uhr Platz hat. Die Frage stellt ausschließlich `useViewport`; eine
  // zweite, handgeschriebene Breitenabfrage driftet still von antds Schwellen weg
  // (erzwungen von `useViewport.guard.test.ts`).
  const { abBreite } = useViewport();
  const breit = abBreite('lg');
  const mittel = abBreite('md');
  // Wie im Einsatz-Kopf: unter `xl` steht der Ruhezustand der SYNC-Anzeige nur als Ikone.
  const weit = abBreite('xl');
  const { token } = theme.useToken();
  // Unter `md` rücken die Zellen zusammen: mit der vollen Staffel-Polsterung (18 px je Seite
  // in `komfortabel`) bräche die rechte Zellgruppe auf 390 px in eine dritte Zeile um.
  const zellToken = mittel ? token : { padding: token.paddingXS };
  // Der Verwaltungs-Link ist ein handgebautes Bedienziel: ZWEI Angaben (LFH-365). Farbe aus
  // der Nachtrolle, weil die Leiste in beiden Modi dunkel ist (vorher `#fff`).
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
            Farbschema und Bediendichte wohnen seit LFH-392 im Benutzermenü, nicht hier:
            Einstellungen gehören nicht in eine Aktionsreihe. */}
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
