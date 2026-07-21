import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { SITZUNG_ABGELAUFEN } from './sitzungsEvent';

/** Einziger Empfänger von {@link SITZUNG_ABGELAUFEN} (LFH-268/F24). Gehört in `App`, weil das
 *  die oberste Komponente innerhalb von `AntApp`, `BrowserRouter` und `AuthProvider` ist — die
 *  Vorgänger-Brücke saß in `EinsatzLayout` und ließ damit `/admin`, `/profil`, die Stammdaten
 *  und die Einsatzliste ohne jede 401-Behandlung. */
export function useSitzungsWache(): void {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const { pathname, search, hash } = useLocation();

  useEffect(() => {
    // Auf der Login-Seite selbst gäbe es nichts umzuleiten — und der Rückkehr-Pfad wäre
    // `/login`, was nach dem Anmelden auf sich selbst zeigte.
    if (pathname === '/login') return;

    const beiAblauf = () => {
      // Vollständige Rückkehr-URL: `pathname` allein verliert die Deeplink-Selektion des
      // Query-Param-Musters (`?einheit=`, `?meldung=`, ETB `?eintrag=` — s. CLAUDE.md).
      const von = `${pathname}${search}${hash}`;
      // `AuthContext.logout` wirft heute nicht mehr (räumt im `finally`). Das `catch` hält
      // die Umleitung trotzdem unabhängig davon: an einem sicherheitsrelevanten Seam soll
      // eine gebrochene Zusage keine unbehandelte Rejection und keinen hängenden Nutzer
      // erzeugen.
      void logout()
        .catch(() => {})
        .finally(() => navigate('/login', { replace: true, state: { von } }));
    };
    window.addEventListener(SITZUNG_ABGELAUFEN, beiAblauf);
    return () => window.removeEventListener(SITZUNG_ABGELAUFEN, beiAblauf);
  }, [logout, navigate, pathname, search, hash]);
}
