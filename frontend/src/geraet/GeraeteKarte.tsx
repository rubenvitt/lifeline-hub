import type { ReactNode } from 'react';
import { Bildmarke } from '../marke/Bildmarke';
import '../pages/LoginPage.css';

/**
 * Rahmen der Seiten ohne Sitzung eines Geräts (`/koppeln`, „Kopplung beendet“, LFH-892): dieselbe
 * Karte wie die Anmeldung, damit das Gerät erkennbar dieselbe Anwendung zeigt.
 */
export function GeraeteKarte({
  untertitel,
  children,
}: {
  untertitel: string;
  children: ReactNode;
}) {
  return (
    <div className="login-seite">
      <div className="login-karte">
        <div className="login-marke">
          <div className="login-marke__zeile">
            <Bildmarke hoehe={20} linienFarbe="var(--lfh-text)" quadratFarbe="var(--lfh-marke)" />
            <h1 className="login-marke__name">lifeline-hub</h1>
          </div>
          <p className="login-marke__untertitel">{untertitel}</p>
        </div>
        {children}
      </div>
    </div>
  );
}
