import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import type { BenutzerAnzeige } from '../api/types';
import { ApiError, setzeErwartetenBenutzer } from '../api/client';
import * as authApi from '../api/auth';
import { abonniereAuthWechsel, meldeAuthWechsel } from './authKanal';
import {
  BENUTZER_PRUEFEN,
  meldeSitzungAbgelaufen,
  sitzungsMeldungZuruecksetzen,
} from './sitzungsEvent';

/** Ergebnis von `login()` (LFH-43, Increment 5): unterscheidet den Sofort-Erfolg (Session
 *  bereits gesetzt, `benutzer` im Context übernommen) vom TOTP-Zweitfaktor-Fall
 *  (`mfa_erforderlich`, s. `authApi.login`-Doc) — die aufrufende Seite (`LoginPage`) schaltet im
 *  letzteren Fall auf die Code-Eingabe um, statt direkt zu navigieren. `benutzer` bleibt in
 *  diesem Fall bewusst `null`: es gibt noch keine Session. */
export type LoginErgebnis = { status: 'ok' } | { status: 'mfa_erforderlich' };

/** Die Sitzung gehört einem anderen Benutzer als dem, den dieser Tab zeigt (LFH-387): in einem
 *  anderen Tab hat sich `jetzt` angemeldet. Der Tab bleibt bei `bisher` — seine
 *  Schreibanfragen tragen weiter dessen Kennung und scheitern am Server mit 412 —, bis die
 *  Person per {@link AuthWert.weiterAls} übernimmt. */
export interface BenutzerKonflikt {
  bisher: BenutzerAnzeige;
  jetzt: BenutzerAnzeige;
}

interface AuthWert {
  benutzer: BenutzerAnzeige | null;
  laedt: boolean;
  login: (benutzername: string, passwort: string) => Promise<LoginErgebnis>;
  /** Meldet über den Server ab. `true`, wenn dieser Tab danach abgemeldet ist; `false`, wenn
   *  der Server ablehnte, weil die Sitzung inzwischen einem anderen Benutzer gehört (412,
   *  LFH-387) — dann bleibt der Tab angemeldet und zeigt den {@link BenutzerKonflikt}, statt die
   *  fremde Sitzung zu beenden. */
  logout: () => Promise<boolean>;
  /** Räumt nur den Zustand dieses Tabs, ohne Server-Logout (LFH-387). Für einen erkannten
   *  Sitzungsablauf: die Sitzung ist ohnehin tot, und ein Server-Logout träfe in der Lücke
   *  „401 → Logout“ eine inzwischen in einem anderen Tab neu angelegte Sitzung. */
  abmeldenLokal: () => void;
  /** Steht, solange die Sitzung einem anderen Benutzer gehört (LFH-387). */
  konflikt: BenutzerKonflikt | null;
  /** Löst den {@link konflikt}: übernimmt den neuen Benutzer. Den Cache räumt der Aufrufer. */
  weiterAls: () => void;
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
  const [konflikt, setKonflikt] = useState<BenutzerKonflikt | null>(null);
  // Refs für die Prüfung, die aus Fremd-Ereignissen läuft und nicht an einen Render gebunden
  // sein darf: sie muss den Benutzer von JETZT vergleichen, nicht den ihres Closures.
  const benutzerRef = useRef<BenutzerAnzeige | null>(null);
  const laedtRef = useRef(true);
  const laufendePruefung = useRef<Promise<void> | null>(null);
  const nachlaufNoetig = useRef(false);

  /** Einziger Weg, den Benutzer zu setzen: hält den erwarteten Benutzer der Schreibanfragen
   *  (`api/client.ts`) synchron mit dem Zustand — ein Effekt ließe ein Render-Fenster offen,
   *  in dem der Tab schon B zeigt, aber noch als A schreibt (oder umgekehrt). */
  const uebernimm = useCallback((b: BenutzerAnzeige | null) => {
    benutzerRef.current = b;
    setzeErwartetenBenutzer(b?.id ?? null);
    setBenutzer(b);
  }, []);

  useEffect(() => {
    let aktiv = true;
    authApi
      .me()
      .then((b) => {
        if (aktiv) uebernimm(b);
      })
      .catch((e) => {
        if (!aktiv) return;
        // 401 = nicht angemeldet (erwartet); andere Fehler ebenfalls als „anonym" behandeln
        if (!(e instanceof ApiError)) console.error('Auth-Prüfung fehlgeschlagen', e);
        uebernimm(null);
      })
      .finally(() => {
        if (!aktiv) return;
        laedtRef.current = false;
        setLaedt(false);
      });
    return () => {
      aktiv = false;
      setzeErwartetenBenutzer(null);
    };
  }, [uebernimm]);

  const abmeldenLokal = useCallback(() => {
    const warAngemeldet = benutzerRef.current !== null;
    uebernimm(null);
    setKonflikt(null);
    // Nur ein echter Wechsel wird gemeldet — sonst schaukelten sich die Tabs mit
    // „abgemeldet“ gegenseitig auf.
    if (warAngemeldet) meldeAuthWechsel({ art: 'abgemeldet' });
  }, [uebernimm]);

  /** Prüft, wem die Sitzung gehört (LFH-387). Die Wahrheit ist `GET /api/auth/me`; Anstöße
   *  (Kanal, 412, Sichtbarkeit) tragen keine Daten. Anstöße während eines Laufs lösen genau
   *  EINEN Nachlauf aus — zusammengefasst, aber nicht verschluckt: der Lauf kann eine Antwort
   *  von vor dem Wechsel bekommen haben, den der spätere Anstoß meldet. Vor dem Erstladen wird
   *  nicht geprüft — das Erstladen IST die Prüfung. */
  const pruefe = useCallback(
    function pruefeSelbst(): Promise<void> {
      if (laedtRef.current) return Promise.resolve();
      if (laufendePruefung.current) {
        nachlaufNoetig.current = true;
        return laufendePruefung.current;
      }
      const lauf = (async () => {
        let aufServer: BenutzerAnzeige;
        try {
          aufServer = await authApi.me();
        } catch (e) {
          // Keine gültige Sitzung: lokal abmelden, die Sitzungswache leitet mit Rückkehrziel zur
          // Anmeldung. Server nicht erreichbar (offline) oder sonstiger Fehler: nichts ändern.
          if (e instanceof ApiError && e.status === 401 && benutzerRef.current) {
            abmeldenLokal();
            meldeSitzungAbgelaufen();
          }
          return;
        }
        const lokal = benutzerRef.current;
        if (!lokal) {
          // In einem anderen Tab angemeldet, dieser Tab war anonym: übernehmen.
          uebernimm(aufServer);
          sitzungsMeldungZuruecksetzen();
          return;
        }
        setKonflikt(lokal.id === aufServer.id ? null : { bisher: lokal, jetzt: aufServer });
      })().finally(() => {
        laufendePruefung.current = null;
        if (nachlaufNoetig.current) {
          nachlaufNoetig.current = false;
          void pruefeSelbst();
        }
      });
      laufendePruefung.current = lauf;
      return lauf;
    },
    [abmeldenLokal, uebernimm],
  );

  useEffect(() => {
    const anstossen = () => void pruefe();
    const beiSichtbarkeit = () => {
      if (document.visibilityState === 'visible') anstossen();
    };
    const abbestellen = abonniereAuthWechsel(anstossen);
    window.addEventListener(BENUTZER_PRUEFEN, anstossen);
    document.addEventListener('visibilitychange', beiSichtbarkeit);
    return () => {
      abbestellen();
      window.removeEventListener(BENUTZER_PRUEFEN, anstossen);
      document.removeEventListener('visibilitychange', beiSichtbarkeit);
    };
  }, [pruefe]);

  const login = useCallback(
    async (benutzername: string, passwort: string): Promise<LoginErgebnis> => {
      const antwort = await authApi.login(benutzername, passwort);
      // Untagged Union (s. `authApi.login`-Doc): der MFA-Zweig ist am `mfa_erforderlich`-Feld
      // erkennbar, das die bare `BenutzerAnzeige` nie trägt. KEIN `setBenutzer` in diesem Fall —
      // es gibt noch keine Session.
      if ('mfa_erforderlich' in antwort) {
        return { status: 'mfa_erforderlich' };
      }
      uebernimm(antwort);
      setKonflikt(null);
      // Neue gültige Sitzung → die Melde-Sperre aus `meldeSitzungAbgelaufen` lösen, damit ein
      // SPÄTERER Ablauf in derselben Browser-Sitzung wieder gemeldet wird (LFH-268).
      sitzungsMeldungZuruecksetzen();
      meldeAuthWechsel({ art: 'angemeldet' });
      return { status: 'ok' };
    },
    [uebernimm],
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
   *  Einzige Ausnahme ist 412 (LFH-387): die Sitzung gehört inzwischen jemand anderem, der
   *  Server hat sie deshalb NICHT beendet. Der Tab bleibt stehen; die 412 hat über
   *  `api/client.ts` bereits die Prüfung angestoßen, die den Konflikt anzeigt. */
  const logout = useCallback(async (): Promise<boolean> => {
    try {
      await authApi.logout();
    } catch (e) {
      if (e instanceof ApiError && e.status === 412) return false;
      console.error('Server-Abmeldung fehlgeschlagen — es wird trotzdem lokal abgemeldet', e);
    }
    abmeldenLokal();
    return true;
  }, [abmeldenLokal]);

  const aktualisiere = useCallback(async () => {
    const b = await authApi.me();
    uebernimm(b);
    setKonflikt(null);
    // Wie in `login`: Passkey- und TOTP-Login etablieren die Sitzung hierüber (LFH-268).
    sitzungsMeldungZuruecksetzen();
    meldeAuthWechsel({ art: 'angemeldet' });
  }, [uebernimm]);

  const weiterAls = useCallback(() => {
    if (!konflikt) return;
    uebernimm(konflikt.jetzt);
    setKonflikt(null);
    sitzungsMeldungZuruecksetzen();
  }, [konflikt, uebernimm]);

  const wert = useMemo<AuthWert>(
    () => ({ benutzer, laedt, login, logout, aktualisiere, abmeldenLokal, konflikt, weiterAls }),
    [benutzer, laedt, login, logout, aktualisiere, abmeldenLokal, konflikt, weiterAls],
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
