import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useAuth } from './AuthContext';
import { SITZUNG_ABGELAUFEN } from './sitzungsEvent';

/** Einziger Empfänger von {@link SITZUNG_ABGELAUFEN} (LFH-268/F24). Gehört ins persistente Root-Layout (`App`/`SitzungsLayout`) innerhalb von
 *  `AntApp`, Data Router und `AuthProvider` — die
 *  Vorgänger-Brücke saß in `EinsatzLayout` und ließ damit `/admin`, `/profil`, die Stammdaten
 *  und die Einsatzliste ohne jede 401-Behandlung. */
export function useSitzungsWache(): void {
  const { abmeldenLokal } = useAuth();
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
      // NUR lokal abmelden (LFH-387): die Sitzung ist abgelaufen, serverseitig gibt es nichts
      // zu beenden. Ein `POST /api/auth/logout` liefe mit dem Cookie, das der Browser JETZT
      // hält — hat sich zwischen der 401 und diesem Ruf in einem anderen Tab jemand angemeldet,
      // beendete er dessen Sitzung. Die Umleitung hängt trotzdem nicht am Abmelden: an einem
      // sicherheitsrelevanten Seam soll eine gebrochene Zusage keinen hängenden Nutzer erzeugen.
      try {
        abmeldenLokal();
      } catch (e) {
        console.error('Lokales Abmelden nach Sitzungsablauf fehlgeschlagen', e);
      }
      navigate('/login', { replace: true, state: { von } });
    };
    window.addEventListener(SITZUNG_ABGELAUFEN, beiAblauf);
    return () => window.removeEventListener(SITZUNG_ABGELAUFEN, beiAblauf);
  }, [abmeldenLokal, navigate, pathname, search, hash]);
}
