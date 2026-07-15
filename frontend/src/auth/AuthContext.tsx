import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { BenutzerAnzeige } from '../api/types';
import { ApiError } from '../api/client';
import * as authApi from '../api/auth';

interface AuthWert {
  benutzer: BenutzerAnzeige | null;
  laedt: boolean;
  login: (benutzername: string, passwort: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Lädt `/api/auth/me` neu und übernimmt den Benutzer in den Context — für Login-Wege,
   *  die (anders als `login()`) die Session ohne einen Aufruf von `authApi.login`
   *  etablieren, z.B. den WebAuthn-Passkey-Login (LFH-275): `auth/finish` setzt das
   *  Session-Cookie server­seitig, der Client muss den Benutzer danach selbst nachladen. */
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

  const login = useCallback(async (benutzername: string, passwort: string) => {
    const b = await authApi.login(benutzername, passwort);
    setBenutzer(b);
  }, []);

  const logout = useCallback(async () => {
    await authApi.logout();
    setBenutzer(null);
  }, []);

  const aktualisiere = useCallback(async () => {
    const b = await authApi.me();
    setBenutzer(b);
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
