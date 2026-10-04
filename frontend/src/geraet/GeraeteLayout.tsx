import { Navigate, Outlet } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import { ANSICHT_LABEL } from '../pages/einstellungen/geraeteKern';

/**
 * Hülle eines gekoppelten Geräts (LFH-892, design.md D9): keine Modulleiste, keine Sprungpalette,
 * kein Benutzermenü. Eine Person landet hier nicht; `RequireAuth` hält das Gerät umgekehrt auf
 * diesen Pfaden.
 */
export default function GeraeteLayout() {
  const { geraet } = useAuth();
  if (!geraet) return <Navigate to="/einsaetze" replace />;
  return (
    <div className="geraet-huelle">
      <header className="geraet-kopf">
        <strong>{geraet.stelle ?? ANSICHT_LABEL[geraet.ansicht]}</strong>
        <span> · {geraet.bezeichnung}</span>
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  );
}
