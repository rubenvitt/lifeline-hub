import { Layout, Space, Typography } from 'antd';
import { Link, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import ThemeToggle from './ThemeToggle';
import BenutzerMenu from './BenutzerMenu';
import type { BenutzerAnzeige } from '../api/types';

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

function darfAdmin(b: BenutzerAnzeige | null): boolean {
  return b?.system_rolle === 'admin' || b?.org_rolle === 'fuehrungskraft';
}

export default function AppLayout() {
  const { benutzer } = useAuth();

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <Link to="/einsaetze" style={{ color: '#fff', fontWeight: 600, fontSize: 18 }}>
          lifeline-hub
        </Link>
        <GlobalLink to="/admin" label="Verwaltung" gesperrt={!darfAdmin(benutzer)} />
        <Space style={{ marginLeft: 'auto' }} size="middle">
          <ThemeToggle />
          <BenutzerMenu />
        </Space>
      </Header>
      <Content style={{ padding: 24 }}>
        <Outlet />
      </Content>
    </Layout>
  );
}
