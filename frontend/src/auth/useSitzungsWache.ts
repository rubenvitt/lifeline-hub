import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useAuth } from './AuthContext';
import { SITZUNG_ABGELAUFEN } from './sitzungsEvent';
import { warGeraet } from '../geraet/geraetMarke';
import { KOPPLUNG_BEENDET_PFAD } from '../routing/deeplinks';

/**
 * Einziger Empfänger von {@link SITZUNG_ABGELAUFEN}. Gehört ins persistente Root-Layout
 * innerhalb von `AntApp`, Data Router und `AuthProvider`, damit jede Route eine
 * 401-Behandlung hat.
 */
export function useSitzungsWache(): void {
  const { abmeldenLokal } = useAuth();
  const navigate = useNavigate();
  const { pathname, search, hash } = useLocation();

  useEffect(() => {
    // Auf der Login-Seite gibt es nichts umzuleiten; der Rückkehr-Pfad zeigte auf sich selbst.
    if (pathname === '/login' || pathname === KOPPLUNG_BEENDET_PFAD) return;

    const beiAblauf = () => {
      // Vollständige Rückkehr-URL: `pathname` allein verlöre die Deeplink-Selektion (`?eintrag=` …).
      const von = `${pathname}${search}${hash}`;
      // NUR lokal abmelden (LFH-387): ein Server-Logout liefe mit dem Cookie von JETZT und
      // beendete eine inzwischen in einem anderen Tab angelegte Sitzung. Die Umleitung hängt
      // nicht am Abmelden — an diesem Seam soll kein hängender Nutzer entstehen.
      // Der Benutzer ist sofort weg, das Lagebild (LFH-723) und die übrigen Gerätedaten (LFH-767)
      // räumen im Hintergrund nach; ETB-Entwürfe überleben das Sitzungsende.
      const fehler = (e: unknown) =>
        console.error('Lokales Abmelden nach Sitzungsablauf fehlgeschlagen', e);
      try {
        abmeldenLokal('sitzungsende').catch(fehler);
      } catch (e) {
        fehler(e);
      }
      // Ein gekoppeltes Gerät bekommt keine Anmeldung für Personen (LFH-892).
      if (warGeraet()) navigate(KOPPLUNG_BEENDET_PFAD, { replace: true });
      else navigate('/login', { replace: true, state: { von } });
    };
    window.addEventListener(SITZUNG_ABGELAUFEN, beiAblauf);
    return () => window.removeEventListener(SITZUNG_ABGELAUFEN, beiAblauf);
  }, [abmeldenLokal, navigate, pathname, search, hash]);
}
