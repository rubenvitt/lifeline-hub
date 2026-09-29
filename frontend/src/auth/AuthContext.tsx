import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { BenutzerAnzeige } from '../api/types';
import { ApiError } from '../api/client';
import * as authApi from '../api/auth';
import { sitzungsMeldungZuruecksetzen } from './sitzungsEvent';

/**
 * Ergebnis von `login()`: Sofort-Erfolg oder TOTP-Zweitfaktor (`mfa_erforderlich`), bei dem
 * `LoginPage` auf die Code-Eingabe umschaltet. `benutzer` bleibt dann `null`: es gibt noch
 * keine Session.
 */
export type LoginErgebnis = { status: 'ok' } | { status: 'mfa_erforderlich' };

interface AuthWert {
  benutzer: BenutzerAnzeige | null;
  laedt: boolean;
  login: (benutzername: string, passwort: string) => Promise<LoginErgebnis>;
  logout: () => Promise<void>;
  /**
   * Lädt `/api/auth/me` neu und übernimmt den Benutzer — für Login-Wege, die die Session
   * serverseitig ohne `authApi.login` setzen (Passkey, `totpFinish`).
   */
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
      // Untagged Union: der MFA-Zweig ist am Feld `mfa_erforderlich` erkennbar. KEIN `setBenutzer`
      // — es gibt noch keine Session.
      if ('mfa_erforderlich' in antwort) {
        return { status: 'mfa_erforderlich' };
      }
      setBenutzer(antwort);
      // Neue gültige Sitzung → Melde-Sperre lösen, damit ein späterer Ablauf wieder gemeldet wird.
      sitzungsMeldungZuruecksetzen();
      return { status: 'ok' };
    },
    [],
  );

  /**
   * Meldet ab und wirft **nie** — die lokale Abmeldung darf nicht am Serverruf hängen.
   * Bliebe `benutzer` nach einem Fehler gesetzt, ließe `RequireAuth` geschützte Routen passieren,
   * und die Sitzungswache meldete wegen ihrer Sperre keinen Ablauf mehr. Lokal abgemeldet zu sein
   * ist in jedem Fall der sicherere Zustand.
   */
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
    // Wie in `login`: Passkey- und TOTP-Login etablieren die Sitzung hierüber.
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

/**
 * Wie {@link useAuth}, aber ohne Provider `null` statt einer Ausnahme.
 *
 * Für Rahmen, die zulässig OHNE `AuthProvider` gerendert werden (etwa `CommandPaletteProvider`
 * in Testflächen); „kein Provider" heißt dann still „nicht angemeldet". Wer den Benutzer
 * BRAUCHT, nimmt `useAuth`.
 */
export function useAuthOptional(): AuthWert | null {
  return useContext(AuthContext);
}
