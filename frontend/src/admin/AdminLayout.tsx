import { Spin, Tabs } from 'antd';
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import type { BenutzerAnzeige } from '../api/types';

/** Darf auf den Admin-Bereich zugreifen: System-Admin oder Führungskraft. */
export function darfAdmin(b: BenutzerAnzeige | null): boolean {
  return b?.system_rolle === 'admin' || b?.org_rolle === 'fuehrungskraft';
}

const TAB_ITEMS = [
  { key: 'stammdaten', label: 'Stammdaten' },
  { key: 'einstellungen', label: 'Einstellungen' },
];

/**
 * Admin-Shell: Sub-Navigation (Stammdaten / Einstellungen) + Outlet.
 * Sitzt unter <AppLayout> (globale Topbar kommt von dort).
 * Gate: admin oder fuehrungskraft — sonst Redirect zu /einsaetze.
 */
export default function AdminLayout() {
  const { benutzer, laedt } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  if (laedt) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 80 }}>
        <Spin size="large" />
      </div>
    );
  }

  if (!darfAdmin(benutzer)) {
    return <Navigate to="/einsaetze" replace />;
  }

  const activeKey = pathname.startsWith('/admin/einstellungen') ? 'einstellungen' : 'stammdaten';

  return (
    <div>
      <Tabs
        activeKey={activeKey}
        items={TAB_ITEMS}
        onChange={(key) => navigate(`/admin/${key}`)}
      />
      <Outlet />
    </div>
  );
}
