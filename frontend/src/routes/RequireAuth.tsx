import { Spin } from 'antd';
import { Navigate, Outlet, useLocation } from 'react-router';
import { useAuth } from '../auth/AuthContext';

/** Schützt verschachtelte Routen: leitet nicht angemeldete Nutzer nach /login um. */
export default function RequireAuth() {
  const { benutzer, laedt } = useAuth();
  const location = useLocation();

  if (laedt) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 120 }}>
        <Spin size="large" />
      </div>
    );
  }
  if (!benutzer) {
    // Vollständige URL: `pathname` allein verliert die Deeplink-Selektion des
    // Query-Param-Musters (`?einheit=`, `?meldung=`, ETB `?eintrag=` — s. CLAUDE.md).
    const von = `${location.pathname}${location.search}${location.hash}`;
    return <Navigate to="/login" replace state={{ von }} />;
  }
  return <Outlet />;
}
