import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { BenutzerAnzeige } from '../api/types';
import { ApiError } from '../api/client';
import * as authApi from '../api/auth';
import { sitzungsMeldungZuruecksetzen } from './sitzungsEvent';

/** Ergebnis von `login()` (LFH-43, Increment 5): unterscheidet den Sofort-Erfolg (Session
 *  bereits gesetzt, `benutzer` im Context übernommen) vom TOTP-Zweitfaktor-Fall
 *  (`mfa_erforderlich`, s. `authApi.login`-Doc) — die aufrufende Seite (`LoginPage`) schaltet im
 *  letzteren Fall auf die Code-Eingabe um, statt direkt zu navigieren. `benutzer` bleibt in
 *  diesem Fall bewusst `null`: es gibt noch keine Session. */
export type LoginErgebnis = { status: 'ok' } | { status: 'mfa_erforderlich' };

interface AuthWert {
  benutzer: BenutzerAnzeige | null;
  laedt: boolean;
  login: (benutzername: string, passwort: string) => Promise<LoginErgebnis>;
  logout: () => Promise<void>;
  /** Lädt `/api/auth/me` neu und übernimmt den Benutzer in den Context — für Login-Wege,
   *  die (anders als `login()`) die Session ohne einen Aufruf von `authApi.login`
   *  etablieren, z.B. den WebAuthn-Passkey-Login (LFH-275) oder den zweiten Schritt des
   *  TOTP-Logins (`totpFinish`, LFH-43): `auth/finish`/`totp/finish` setzen das Session-Cookie
   *  server­seitig, der Client muss den Benutzer danach selbst nachladen. */
  aktualisiere: () => Promise<void>;
}

const AuthContext = createContext<AuthWert | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [benutzer, setBenutzer] = useState<BenutzerAnzeige | null>(null);
  const [laedt, setLaedt] = useState(true);

  useEffect(() => {
    let aktiv = true;
    authApi
      .me()
      .then((b) => {
        if (aktiv) setBenutzer(b);
      })
      .catch((e) => {
        if (!aktiv) return;
        // 401 = nicht angemeldet (erwartet); andere Fehler ebenfalls als „anonym" behandeln
        if (!(e instanceof ApiError)) console.error('Auth-Prüfung fehlgeschlagen', e);
        setBenutzer(null);
      })
      .finally(() => {
        if (aktiv) setLaedt(false);
      });
    return () => {
      aktiv = false;
    };
  }, []);

  const login = useCallback(
    async (benutzername: string, passwort: string): Promise<LoginErgebnis> => {
      const antwort = await authApi.login(benutzername, passwort);
      // Untagged Union (s. `authApi.login`-Doc): der MFA-Zweig ist am `mfa_erforderlich`-Feld
      // erkennbar, das die bare `BenutzerAnzeige` nie trägt. KEIN `setBenutzer` in diesem Fall —
      // es gibt noch keine Session.
      if ('mfa_erforderlich' in antwort) {
        return { status: 'mfa_erforderlich' };
      }
      setBenutzer(antwort);
      // Neue gültige Sitzung → die Melde-Sperre aus `meldeSitzungAbgelaufen` lösen, damit ein
      // SPÄTERER Ablauf in derselben Browser-Sitzung wieder gemeldet wird (LFH-268).
      sitzungsMeldungZuruecksetzen();
      return { status: 'ok' };
    },
    [],
  );

  /** Meldet ab und wirft dabei **nie** — die lokale Abmeldung darf nicht am Serverruf hängen.
   *
   *  `session::loeschen` propagiert seinen Fehler (`src/routes/auth.rs:226`), ein Netzabriss
   *  wirft ohnehin. Bliebe `benutzer` in dem Fall gesetzt, wäre der Nutzer sichtbar
   *  „angemeldet" bei toter Session: `RequireAuth` ließe geschützte Routen passieren, und die
   *  Sitzungswache (LFH-268) meldete wegen ihrer Wiederhol-Sperre keinen weiteren Ablauf mehr
   *  — die App stünde still und ohne Re-Login-Angebot da. Serverseitig läuft die Session
   *  regulär ab; lokal abgemeldet zu sein ist in jedem Fall der sicherere Zustand. */
  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch (e) {
      console.error('Server-Abmeldung fehlgeschlagen — es wird trotzdem lokal abgemeldet', e);
    } finally {
      setBenutzer(null);
    }
  }, []);

  const aktualisiere = useCallback(async () => {
    const b = await authApi.me();
    setBenutzer(b);
    // Wie in `login`: Passkey- und TOTP-Login etablieren die Sitzung hierüber (LFH-268).
    sitzungsMeldungZuruecksetzen();
  }, []);

  const wert = useMemo<AuthWert>(
    () => ({ benutzer, laedt, login, logout, aktualisiere }),
    [benutzer, laedt, login, logout, aktualisiere],
  );

  return <AuthContext.Provider value={wert}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthWert {
  const wert = useContext(AuthContext);
  if (!wert) throw new Error('useAuth muss innerhalb von <AuthProvider> verwendet werden');
  return wert;
}
