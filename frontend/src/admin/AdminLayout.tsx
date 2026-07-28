import { Layout, Menu, Spin, theme } from 'antd';
import type { MenuProps } from 'antd';
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import { darfVerwaltung } from '../einsatz/schreibrecht';
import { adminBenutzer, adminGruppen } from './adminNav';

const { Sider, Content } = Layout;

/**
 * Admin-Shell (LFH-284): eine linke Sidebar (gruppiertes `Menu`) als EINZIGE Nav-Ebene für
 * `/admin` + `<Outlet>`. Löst die frühere doppelte Nav (Top-Tabs + In-Page-Umschalter) auf.
 * Menu-Einträge und Routen stammen aus derselben `adminNav`-Registry; die aktive Sektion folgt
 * der URL (kein eigener Nav-State). Sitzt unter <AppLayout> (globale Topbar kommt von dort).
 * Gate: `darfVerwaltung` (admin oder fuehrungskraft, seit LFH-328 aus `einsatz/schreibrecht.ts`
 * statt lokaler Kopie) — sonst Redirect zu /einsaetze. Benutzer-Eintrag nur für System-Admins
 * (strengeres Gate der Seite selbst bleibt zusätzlich bestehen).
 */
export default function AdminLayout() {
  const { benutzer, laedt } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { token } = theme.useToken();

  if (laedt) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 80 }}>
        <Spin size="large" />
      </div>
    );
  }

  if (!darfVerwaltung(benutzer)) {
    return <Navigate to="/einsaetze" replace />;
  }

  const istSystemAdmin = benutzer?.system_rolle === 'admin';
  // '/admin/stammdaten/fahrzeuge' → 'stammdaten/fahrzeuge'; '/admin/benutzer' → 'benutzer'.
  const aktiv = pathname.replace(/^\/admin\/?/, '');

  const items: MenuProps['items'] = [
    ...adminGruppen.map((g) => ({
      key: g.key,
      type: 'group' as const,
      label: g.label,
      children: g.sektionen.map((s) => ({ key: `${g.key}/${s.key}`, label: s.label })),
    })),
    ...(istSystemAdmin ? [{ key: adminBenutzer.key, label: adminBenutzer.label }] : []),
  ];

  return (
    <Layout style={{ background: 'transparent' }}>
      <Sider
        theme="light"
        width={220}
        breakpoint="lg"
        collapsedWidth={0}
        style={{ background: 'transparent' }}
      >
        <Menu
          mode="inline"
          items={items}
          selectedKeys={[aktiv]}
          onClick={({ key }) => navigate(`/admin/${key}`)}
          style={{ background: 'transparent', borderInlineEnd: 'none' }}
        />
      </Sider>
      <Content style={{ paddingInlineStart: token.paddingLG }}>
        <Outlet />
      </Content>
    </Layout>
  );
}
