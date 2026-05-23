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
}

const AuthContext = createContext<AuthWert | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [benutzer, setBenutzer] = useState<BenutzerAnzeige | null>(null);
  const [laedt, setLaedt] = useState(true);

  useEffect(() => {
    authApi
      .me()
      .then((b) => setBenutzer(b))
      .catch((e) => {
        // 401 = nicht angemeldet (erwartet); andere Fehler ebenfalls als „anonym" behandeln
        if (!(e instanceof ApiError)) console.error('Auth-Prüfung fehlgeschlagen', e);
        setBenutzer(null);
      })
      .finally(() => setLaedt(false));
  }, []);

  const login = useCallback(async (benutzername: string, passwort: string) => {
    const b = await authApi.login(benutzername, passwort);
    setBenutzer(b);
  }, []);

  const logout = useCallback(async () => {
    await authApi.logout();
    setBenutzer(null);
  }, []);

  const wert = useMemo<AuthWert>(
    () => ({ benutzer, laedt, login, logout }),
    [benutzer, laedt, login, logout],
  );

  return <AuthContext.Provider value={wert}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthWert {
  const wert = useContext(AuthContext);
  if (!wert) throw new Error('useAuth muss innerhalb von <AuthProvider> verwendet werden');
  return wert;
}
