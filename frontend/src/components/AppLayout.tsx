import { Layout, Space, Tag, Typography } from 'antd';
import { Link, Outlet } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import { darfVerwaltung } from '../einsatz/schreibrecht';
import { farbenDunkel } from '../theme/tokens';
import ThemeToggle from './ThemeToggle';
import BenutzerMenu from './BenutzerMenu';
import CommandPaletteTrigger from './CommandPaletteTrigger';
import { useViewport } from './useViewport';

const { Header, Content } = Layout;

/**
 * Die Kopfzeile trägt ihre Polsterung selbst (LFH-329 · B1/M12).
 *
 * Ohne diesen Stil hinge sie am antd-Komponententoken, der sich aus der
 * Steuerhöhe ableitet und bei der kompakten Stufe rund 47 px je Seite beträgt —
 * auf einem 390-px-Schirm knapp ein Viertel der Breite, nur für Rand. Die Zahl
 * steht NICHT hier, sondern als Custom Property in `theme/rollen.css`: sie
 * hängt am Viewport, und eine Media-Regel greift beim ersten Paint, während
 * eine JS-Ableitung erst nach dem Mount stimmte.
 */
const KOPF_STIL = {
  display: 'flex',
  alignItems: 'center',
  gap: 16,
  paddingInline: 'var(--lfh-kopf-polsterung)',
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
}: {
  to: string;
  label: string;
  gesperrt: boolean;
  grundSichtbar: boolean;
}) {
  if (gesperrt) {
    return (
      <Typography.Text
        style={{
          // Farbrolle statt des abgelösten `rgba(255, 255, 255, 0.35)` (Befund M10): der
          // Hartwert erreichte gegen den Kopfzeilengrund #001529 nur ~3,2:1 und verfehlte
          // WCAG 1.4.3. `farbenDunkel.schwach` liefert gerechnete 5,3:1 und bleibt dabei
          // deutlich schwächer als der weisse Aktiv-Link — die Sperre bleibt ablesbar.
          // `farbenDunkel`, nicht der modusabhängige Token: die Kopfzeile trägt in BEIDEN
          // Modi denselben dunklen Grund (dieselbe Begründung wie `IconRail.tsx:20-21`).
          color: farbenDunkel.schwach,
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
    <Link to={to} style={{ color: '#fff', flexShrink: 0 }}>
      {label}
    </Link>
  );
}

export default function AppLayout() {
  const { benutzer } = useAuth();
  // Dieselbe Schwelle wie im Einsatz-Workspace: unter `lg` legt die Kopfzeile
  // ihre Umschalter ab. Die Frage stellt ausschließlich `useViewport` — eine
  // zweite, handgeschriebene Breitenabfrage driftet still von antds Schwellen
  // weg (erzwungen von `useViewport.guard.test.ts`).
  const { abBreite } = useViewport();
  const breit = abBreite('lg');

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={KOPF_STIL}>
        <Link to="/einsaetze" style={{ color: '#fff', fontWeight: 600, fontSize: 18 }}>
          lifeline-hub
        </Link>
        <GlobalLink
          to="/admin"
          label="Verwaltung"
          gesperrt={!darfVerwaltung(benutzer)}
          grundSichtbar={breit}
        />
        <Space style={{ marginLeft: 'auto' }} size="middle">
          <CommandPaletteTrigger />
          {/* Unter `lg` wandern Farbschema UND Bediendichte ins Benutzermenü —
              nicht ersatzlos weg. Der Umschalter belegt hier zwei Segmentleisten
              nebeneinander; das ist auf 390 px die Hälfte der Zeile. */}
          {breit && <ThemeToggle />}
          <BenutzerMenu />
        </Space>
      </Header>
      <Content style={{ padding: 'var(--lfh-seiten-polsterung)' }}>
        <Outlet />
      </Content>
    </Layout>
  );
}
