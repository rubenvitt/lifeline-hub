import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useAuth } from './AuthContext';
import { SITZUNG_ABGELAUFEN } from './sitzungsEvent';

/**
 * Einziger Empfänger von {@link SITZUNG_ABGELAUFEN}. Gehört ins persistente Root-Layout
 * innerhalb von `AntApp`, Data Router und `AuthProvider`, damit jede Route eine
 * 401-Behandlung hat.
 */
export function useSitzungsWache(): void {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const { pathname, search, hash } = useLocation();

  useEffect(() => {
    // Auf der Login-Seite gibt es nichts umzuleiten; der Rückkehr-Pfad zeigte auf sich selbst.
    if (pathname === '/login') return;

    const beiAblauf = () => {
      // Vollständige Rückkehr-URL: `pathname` allein verlöre die Deeplink-Selektion (`?eintrag=` …).
      const von = `${pathname}${search}${hash}`;
      // `logout` wirft nicht, das `catch` hält die Umleitung trotzdem davon unabhängig: an diesem
      // Seam soll keine unbehandelte Rejection und kein hängender Nutzer entstehen.
      void logout()
        .catch(() => {})
        .finally(() => navigate('/login', { replace: true, state: { von } }));
    };
    window.addEventListener(SITZUNG_ABGELAUFEN, beiAblauf);
    return () => window.removeEventListener(SITZUNG_ABGELAUFEN, beiAblauf);
  }, [logout, navigate, pathname, search, hash]);
}
