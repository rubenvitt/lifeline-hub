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
      // Untagged Union (s. `authApi.login`-Doc): der MFA-Zweig ist am `mfa_erforderlich`-Feld
      // erkennbar, das die bare `BenutzerAnzeige` nie trägt. KEIN `setBenutzer` in diesem Fall —
      // es gibt noch keine Session.
      if ('mfa_erforderlich' in antwort) {
        return { status: 'mfa_erforderlich' };
      }
      // Eine andere Person als die vorherige räumt deren Lagebild, bevor der Benutzer wechselt.
      await lagebildAnmelden(queryClient, antwort);
      setBenutzer(antwort);
      // Neue gültige Sitzung → die Melde-Sperre aus `meldeSitzungAbgelaufen` lösen, damit ein
      // SPÄTERER Ablauf in derselben Browser-Sitzung wieder gemeldet wird (LFH-268).
      sitzungsMeldungZuruecksetzen();
      return { status: 'ok' };
    },
    [queryClient],
  );

  /** Meldet ab und wirft dabei **nie** — die lokale Abmeldung darf nicht am Serverruf hängen.
   *
   *  `session::loeschen` propagiert seinen Fehler (`src/routes/auth.rs:226`), ein Netzabriss
   *  wirft ohnehin. Bliebe `benutzer` in dem Fall gesetzt, wäre der Nutzer sichtbar
   *  „angemeldet" bei toter Session: `RequireAuth` ließe geschützte Routen passieren, und die
   *  Sitzungswache (LFH-268) meldete wegen ihrer Wiederhol-Sperre keinen weiteren Ablauf mehr
   *  — die App stünde still und ohne Re-Login-Angebot da. Serverseitig läuft die Session
   *  regulär ab; lokal abgemeldet zu sein ist in jedem Fall der sicherere Zustand.
   *
   *  Das Lagebild (LFH-723) wird im selben `finally` gelöscht, Speicher UND Platte — auch der
   *  Sitzungsablauf (401 → Sitzungswache) läuft hier durch. */
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
    // Wie in `login`: Passkey- und TOTP-Login etablieren die Sitzung hierüber (LFH-268).
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
 * Wie {@link useAuth}, aber ohne Provider `null` statt einer Ausnahme (LFH-391 · Etappe D).
 *
 * Für querschnittliche Rahmen, die bewusst OHNE App-Provider gerendert werden dürfen —
 * dieselbe Nachsicht, die `useTastaturEbene` gegenüber dem Paletten-Context übt. Der
 * konkrete Anlass ist gemessen: `CommandPaletteProvider` fragt seit dem Befehls-Gedächtnis
 * nach dem angemeldeten Benutzer, und mindestens eine Bestands-Testfläche
 * (`pages/UnfallhilfsstellenPage.test.tsx`, Drawer-Escape) mountet ihn ohne `AuthProvider`.
 *
 * NICHT als bequemere Variante von `useAuth` gedacht: wer den Benutzer BRAUCHT, soll die
 * Ausnahme bekommen. Diese hier ist für Stellen, an denen „kein Provider" eine zulässige
 * Betriebsart ist und still zu „nicht angemeldet" führt.
 */
export function useAuthOptional(): AuthWert | null {
  return useContext(AuthContext);
}
