import { Button, Layout, Space, Tag, Typography } from 'antd';
import { Link, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

const { Header, Content } = Layout;

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
        <Link to="/einsaetze" style={{ color: '#fff' }}>
          Einsätze
        </Link>
        {benutzer?.system_rolle === 'admin' && (
          <Link to="/benutzer" style={{ color: '#fff' }}>
            Benutzer
          </Link>
        )}
        <Space style={{ marginLeft: 'auto' }}>
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
