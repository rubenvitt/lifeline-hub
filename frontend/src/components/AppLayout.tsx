import { Button, Layout, Space, Tag, Typography } from 'antd';
import { Link, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
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

function darfStammdaten(b: BenutzerAnzeige | null): boolean {
  return b?.system_rolle === 'admin' || b?.org_rolle === 'fuehrungskraft';
}

export default function AppLayout() {
  const { benutzer, logout } = useAuth();
  const navigate = useNavigate();

  async function abmelden() {
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <Link to="/einsaetze" style={{ color: '#fff', fontWeight: 600, fontSize: 18 }}>
          lifeline-hub
        </Link>
        <GlobalLink to="/stammdaten" label="Stammdaten" gesperrt={!darfStammdaten(benutzer)} />
        <GlobalLink to="/benutzer" label="Benutzer" gesperrt={benutzer?.system_rolle !== 'admin'} />
        <Space style={{ marginLeft: 'auto' }}>
          <GlobalLink to="/profil" label="Profil" gesperrt={false} />
          <Typography.Text style={{ color: '#fff' }}>{benutzer?.anzeigename}</Typography.Text>
          {benutzer?.system_rolle === 'admin' && <Tag color="gold">Admin</Tag>}
          <Button size="small" onClick={abmelden}>
            Abmelden
          </Button>
        </Space>
      </Header>
      <Content style={{ padding: 24 }}>
        <Outlet />
      </Content>
    </Layout>
  );
}
