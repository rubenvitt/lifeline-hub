import { Spin } from 'antd';
import { Navigate, Outlet, useLocation } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import { warGeraet } from '../geraet/geraetMarke';
import { GERAET_START_PFAD, KOPPLUNG_BEENDET_PFAD } from '../routing/deeplinks';

/**
 * Schützt verschachtelte Routen: leitet nicht angemeldete Nutzer nach /login um.
 *
 * Gekoppelte Geräte (LFH-892): ohne Sitzung „Kopplung beendet" statt der Anmeldung, mit Sitzung
 * jede Adresse außerhalb der Gerätehülle auf deren Startseite. Die Schranke selbst steht beim
 * Server; hier geht es nur darum, dass das Gerät keine Oberfläche zeigt, die es nicht bedienen darf.
 */
export default function RequireAuth() {
  const { benutzer, geraet, laedt } = useAuth();
  const location = useLocation();

  if (laedt) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 120 }}>
        <Spin size="large" />
      </div>
    );
  }
  if (!benutzer && warGeraet()) return <Navigate to={KOPPLUNG_BEENDET_PFAD} replace />;
  if (!benutzer) {
    // Vollständige URL: `pathname` allein verliert die Deeplink-Selektion des
    // Query-Param-Musters (`?einheit=`, `?meldung=`, ETB `?eintrag=` — s. frontend/AGENTS.md).
    const von = `${location.pathname}${location.search}${location.hash}`;
    return <Navigate to="/login" replace state={{ von }} />;
  }
  if (geraet && !istGeraetePfad(location.pathname)) {
    return <Navigate to={GERAET_START_PFAD} replace />;
  }
  return <Outlet />;
}

/** Liegt die Adresse in der Gerätehülle? Segmentgenau: `/geraeteliste` gehört nicht dazu. */
function istGeraetePfad(pfad: string): boolean {
  return pfad === GERAET_START_PFAD || pfad.startsWith(`${GERAET_START_PFAD}/`);
}
