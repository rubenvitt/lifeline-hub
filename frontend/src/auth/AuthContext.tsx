import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { BenutzerAnzeige } from '../api/types';
import { ApiError, NetzFehler } from '../api/client';
import * as authApi from '../api/auth';
import { sitzungsMeldungZuruecksetzen } from './sitzungsEvent';
import {
  lagebildAnmelden,
  lagebildBeenden,
  lagebildLoeschen,
  lagebildStarten,
} from '../offline/lagebildSitzung';
import type { MeErgebnis } from '../offline/lagebildStart';
import {
  GATEWAY_NICHT_ERREICHBAR,
  istVerbindungsfehler,
  meldeServerErreichbar,
} from '../offline/verbindung';

/**
 * Ergebnis von `login()`: Sofort-Erfolg oder TOTP-Zweitfaktor (`mfa_erforderlich`), bei dem
 * `LoginPage` auf die Code-Eingabe umschaltet. `benutzer` bleibt dann `null`: es gibt noch
 * keine Session.
 */
type LoginErgebnis = { status: 'ok' } | { status: 'mfa_erforderlich' };

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

/** Gescheiterte Sitzungsprüfung, klassifiziert für die Lagebild-Vorhaltung (LFH-723): nur ein
 *  Netzfehler (oder die Meldung eines Gateways, der Server sei nicht erreichbar) öffnet die
 *  Offline-Identität, jede Antwort des Servers selbst ungleich Erfolg nicht. */
function meFehlerEinordnen(e: unknown): MeErgebnis {
  // Auch 502/503/504 zählen, gleich von wem: über die Sitzung sagen sie nichts — ein
  // überlasteter eigener Server (503 MIT Umschlag) löschte sonst den vorgehaltenen Stand
  // (design.md D2). Als „nicht erreichbar" für die Kennzeichnung gilt nur ein echter
  // Leitungsfehler (`istVerbindungsfehler`).
  if (
    e instanceof NetzFehler ||
    (e instanceof ApiError && GATEWAY_NICHT_ERREICHBAR.has(e.status))
  ) {
    if (istVerbindungsfehler(e)) meldeServerErreichbar(false);
    return { art: 'netzfehler' };
  }
  // 401 = nicht angemeldet (erwartet); andere Fehler ebenfalls als „anonym" behandeln
  if (!(e instanceof ApiError)) console.error('Auth-Prüfung fehlgeschlagen', e);
  return { art: 'abgelehnt' };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [benutzer, setBenutzer] = useState<BenutzerAnzeige | null>(null);
  const [laedt, setLaedt] = useState(true);
  const queryClient = useQueryClient();

  /**
   * Start: erst die Sitzungsprüfung, dann die Lagebild-Vorhaltung (LFH-723, design.md D2).
   *
   * Ohne Serverbestätigung (Netzfehler) bleibt `laedt` stehen, bis der vorgehaltene Stand im
   * Speicher ist — erst er sagt, WER angemeldet ist, und `RequireAuth` rendert bis dahin
   * nichts Geschütztes. Bei einem gültigen Stand ist die Person danach als der zuletzt
   * bestätigte Benutzer angemeldet, ohne Netz nur lesend. Ein Fremdstand erreicht den
   * Speicher nie: wiederhergestellt wird nur der Stand der bestätigten bzw. gespeicherten
   * Identität selbst.
   */
  useEffect(() => {
    let aktiv = true;
    let bestaetigt = false;
    authApi
      .me()
      .then((b): MeErgebnis => {
        // Serverbestätigt steht alles fest, im selben Takt wie vor LFH-723: Benutzer und
        // Ende des Ladens wechseln ZUSAMMEN (zwei Takte ließen Oberflächen außerhalb von
        // `RequireAuth` ihre Abfragen zweimal einhängen, gemessen an `DemoDatenPage`).
        // Die Wiederherstellung läuft danach — sie bringt nur den EIGENEN Stand, und
        // `hydrate` überschreibt keinen Abruf, der inzwischen neuer ist.
        bestaetigt = true;
        meldeServerErreichbar(true);
        if (aktiv) {
          setBenutzer(b);
          setLaedt(false);
        }
        return { art: 'ok', benutzer: b };
      }, meFehlerEinordnen)
      .then((me) => lagebildStarten(queryClient, me, { abgebrochen: () => !aktiv }))
      .then((b) => {
        if (aktiv) setBenutzer(b);
      })
      .catch((e: unknown) => {
        // Die Vorhaltung fängt ihre Speicherfehler selbst; was hier ankommt, ist unerwartet.
        // Eine bestätigte Sitzung bleibt davon unberührt — nur ohne Bestätigung gibt es dann
        // keinen Benutzer.
        console.error('Start der Sitzung fehlgeschlagen', e);
        if (aktiv && !bestaetigt) setBenutzer(null);
      })
      .finally(() => {
        if (aktiv) setLaedt(false);
      });
    return () => {
      aktiv = false;
      void lagebildBeenden(queryClient);
    };
  }, [queryClient]);

  const login = useCallback(
    async (benutzername: string, passwort: string): Promise<LoginErgebnis> => {
      const antwort = await authApi.login(benutzername, passwort);
      // Untagged Union: der MFA-Zweig ist am Feld `mfa_erforderlich` erkennbar. KEIN `setBenutzer`
      // — es gibt noch keine Session.
      if ('mfa_erforderlich' in antwort) {
        return { status: 'mfa_erforderlich' };
      }
      // Eine andere Person als die vorherige räumt deren Lagebild, bevor der Benutzer wechselt.
      await lagebildAnmelden(queryClient, antwort);
      setBenutzer(antwort);
      // Neue gültige Sitzung → Melde-Sperre lösen, damit ein späterer Ablauf wieder gemeldet wird.
      sitzungsMeldungZuruecksetzen();
      return { status: 'ok' };
    },
    [queryClient],
  );

  /**
   * Meldet ab und wirft **nie** — die lokale Abmeldung darf nicht am Serverruf hängen.
   * Bliebe `benutzer` nach einem Fehler gesetzt, ließe `RequireAuth` geschützte Routen passieren,
   * und die Sitzungswache meldete wegen ihrer Sperre keinen Ablauf mehr. Lokal abgemeldet zu sein
   * ist in jedem Fall der sicherere Zustand. Im selben `finally` wird das Lagebild (LFH-723)
   * gelöscht, Speicher UND Platte; auch der Sitzungsablauf (401 → Sitzungswache) läuft hier durch.
   */
  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch (e) {
      console.error('Server-Abmeldung fehlgeschlagen — es wird trotzdem lokal abgemeldet', e);
    } finally {
      await lagebildLoeschen(queryClient);
      setBenutzer(null);
    }
  }, [queryClient]);

  const aktualisiere = useCallback(async () => {
    const b = await authApi.me();
    await lagebildAnmelden(queryClient, b);
    setBenutzer(b);
    // Wie in `login`: Passkey- und TOTP-Login etablieren die Sitzung hierüber.
    sitzungsMeldungZuruecksetzen();
  }, [queryClient]);

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
