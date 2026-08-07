import { Layout, Space, Typography } from 'antd';
import { LockOutlined } from '@ant-design/icons';
import { Link, Outlet } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import { darfVerwaltung } from '../einsatz/schreibrecht';
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

/** Topbar-Eintrag: Link wenn frei, sonst ausgegraut mit Schloss (disabled statt versteckt). */
function GlobalLink({ to, label, gesperrt }: { to: string; label: string; gesperrt: boolean }) {
  if (gesperrt) {
    return (
      <Typography.Text
        title="Keine Berechtigung"
        style={{ color: 'rgba(255,255,255,0.35)', cursor: 'not-allowed' }}
      >
        {/* Ikone statt Emoji („Ein Emoji ist keine Ikone", 30.07.2026). Das ist hier kein
            reiner Formfehler gewesen: das Emoji stand im Textknoten und damit im
            zugänglichen Namen — vorgelesen wurde „Verwaltung Schloss". Die
            `aria-hidden`-Hülle ist Pflicht, weil ein @ant-design/icons-Knoten `role="img"`
            mit englischem `aria-label` mitbringt. Der zweite Kanal bleibt der `title`
            oben plus `cursor: not-allowed`. */}
        {label}{' '}
        <span aria-hidden>
          <LockOutlined />
        </span>
      </Typography.Text>
    );
  }
  return (
    <Link to={to} style={{ color: '#fff' }}>
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
        <GlobalLink to="/admin" label="Verwaltung" gesperrt={!darfVerwaltung(benutzer)} />
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
