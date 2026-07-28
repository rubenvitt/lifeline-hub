import { Layout, Space, Typography } from 'antd';
import { Link, Outlet } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import { darfVerwaltung } from '../einsatz/schreibrecht';
import ThemeToggle from './ThemeToggle';
import BenutzerMenu from './BenutzerMenu';

const { Header, Content } = Layout;

/** Topbar-Eintrag: Link wenn frei, sonst ausgegraut mit 🔒 (disabled statt versteckt). */
function GlobalLink({ to, label, gesperrt }: { to: string; label: string; gesperrt: boolean }) {
  if (gesperrt) {
    return (
      <Typography.Text
        title="Keine Berechtigung"
        style={{ color: 'rgba(255,255,255,0.35)', cursor: 'not-allowed' }}
      >
        {label} 🔒
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

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <Link to="/einsaetze" style={{ color: '#fff', fontWeight: 600, fontSize: 18 }}>
          lifeline-hub
        </Link>
        <GlobalLink to="/admin" label="Verwaltung" gesperrt={!darfVerwaltung(benutzer)} />
        <Space style={{ marginLeft: 'auto' }} size="middle">
          <ThemeToggle />
          <BenutzerMenu />
        </Space>
      </Header>
      <Content style={{ padding: 'var(--lfh-seiten-polsterung)' }}>
        <Outlet />
      </Content>
    </Layout>
  );
}
