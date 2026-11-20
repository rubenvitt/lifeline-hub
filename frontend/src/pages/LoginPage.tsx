import { Alert, Button } from 'antd';
import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { hilfePfad } from '../routing/deeplinks';
import { useDokumentTitel } from '../components/useDokumentTitel';
import { useAuth } from '../auth/AuthContext';
import AnmeldeFormular from '../auth/AnmeldeFormular';
import { Bildmarke } from '../marke/Bildmarke';
import './LoginPage.css';

export default function LoginPage() {
  useDokumentTitel(['Anmelden']);
  const { benutzer, laedt: authLaedt } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const zustand = location.state as { von?: string; grund?: string } | null;
  const zielPfad = zustand?.von ?? '/einsaetze';
  // Über das Sitzungsende hierher gekommen (Frist oder „Abmelden“ im Dialog, LLH-1770).
  const sitzungBeendet = zustand?.grund === 'sitzung-beendet';
  const anfangsFehler =
    new URLSearchParams(location.search).get('fehler') === 'oidc'
      ? 'Die Anmeldung über Single Sign-On ist fehlgeschlagen'
      : null;

  // Anmeldung aus einem anderen Tab (LFH-387): der AuthProvider übernimmt sie, die Seite zieht
  // nach. Nur beim Übergang „anonym → angemeldet“ — wer angemeldet `/login` aufruft, um den
  // Benutzer zu wechseln, bleibt hier. Der eigene Login navigiert ohnehin selbst dorthin.
  const anonymGesehen = useRef(false);
  useEffect(() => {
    if (authLaedt) return;
    if (benutzer === null) {
      anonymGesehen.current = true;
    } else if (anonymGesehen.current) {
      anonymGesehen.current = false;
      navigate(zielPfad, { replace: true });
    }
  }, [authLaedt, benutzer, navigate, zielPfad]);

  return (
    <div className="login-seite">
      <div className="login-karte">
        <div className="login-marke">
          <div className="login-marke__zeile">
            <Bildmarke hoehe={20} linienFarbe="var(--lfh-text)" quadratFarbe="var(--lfh-marke)" />
            <h1 className="login-marke__name">lifeline-hub</h1>
          </div>
          <p className="login-marke__untertitel">Einsatzführung &amp; Einsatztagebuch</p>
        </div>
        {sitzungBeendet && (
          <Alert
            type="info"
            title="Sitzung beendet – bitte erneut anmelden"
            style={{ marginBottom: 20 }}
            showIcon
          />
        )}
        <AnmeldeFormular
          zielPfad={zielPfad}
          onAngemeldet={() => navigate(zielPfad, { replace: true })}
          mitDevBenutzern
          anfangsFehler={anfangsFehler}
        />
        {/* Hilfe (LFH-1096): das Kapitel zum Anmelden, ohne Sitzung lesbar. */}
        <Button
          type="link"
          block
          className="login-hilfe"
          onClick={() => void navigate(hilfePfad({ kapitel: 'anmelden-abmelden' }))}
        >
          Hilfe
        </Button>
      </div>
    </div>
  );
}
