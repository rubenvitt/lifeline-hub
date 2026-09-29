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

/**
 * Ergebnis von `login()`: Sofort-Erfolg oder TOTP-Zweitfaktor (`mfa_erforderlich`), bei dem
 * `LoginPage` auf die Code-Eingabe umschaltet. `benutzer` bleibt dann `null`: es gibt noch
 * keine Session.
 */
export type LoginErgebnis = { status: 'ok' } | { status: 'mfa_erforderlich' };

/** Die Sitzung gehört einem anderen Benutzer als dem, den dieser Tab zeigt (LFH-387): in einem
 *  anderen Tab hat sich `jetzt` angemeldet. Der Tab bleibt bei `bisher` — seine
 *  Schreibanfragen tragen weiter dessen Kennung und scheitern am Server mit 412 —, bis die
 *  Person im `BenutzerKonfliktDialog` die Seite neu lädt. */
export interface BenutzerKonflikt {
  bisher: BenutzerAnzeige;
  jetzt: BenutzerAnzeige;
}

interface AuthWert {
  benutzer: BenutzerAnzeige | null;
  laedt: boolean;
  login: (benutzername: string, passwort: string) => Promise<LoginErgebnis>;
  /** Meldet über den Server ab. `false`, wenn der Server mit 412 ablehnte (die Sitzung gehört
   *  inzwischen einem anderen Benutzer, LFH-387): dann bleibt der Tab angemeldet. */
  logout: () => Promise<boolean>;
  /** Räumt nur den Zustand dieses Tabs, ohne Server-Logout (LFH-387) — für einen erkannten
   *  Sitzungsablauf; ein Server-Logout träfe eine inzwischen neu angelegte Sitzung. */
  abmeldenLokal: () => void;
  /** Steht, solange die Sitzung einem anderen Benutzer gehört (LFH-387). Aufgelöst per Neuladen
   *  (`BenutzerKonfliktDialog`), nie im laufenden Baum. */
  konflikt: BenutzerKonflikt | null;
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
  const [konflikt, setKonflikt] = useState<BenutzerKonflikt | null>(null);
  // Refs für die Prüfung, die aus Fremd-Ereignissen läuft und nicht an einen Render gebunden
  // sein darf: sie muss den Benutzer von JETZT vergleichen, nicht den ihres Closures.
  const benutzerRef = useRef<BenutzerAnzeige | null>(null);
  const laedtRef = useRef(true);
  const laufendePruefung = useRef<Promise<void> | null>(null);
  const nachlaufNoetig = useRef(false);
  /** Zählt jeden Wechsel des Benutzers. Eine `/me`-Antwort, die VOR einem Wechsel angefragt
   *  wurde (Erstladen oder Prüfung, parallel zu Login/`aktualisiere`), ist veraltet und wird
   *  verworfen — statt einen frischen Login zurückzurollen oder einen Schein-Konflikt zu melden. */
  const generation = useRef(0);

  /** Einziger Weg, den Benutzer zu setzen: hält den erwarteten Benutzer der Schreibanfragen
   *  (`api/client.ts`) synchron mit dem Zustand — ein Effekt ließe ein Render-Fenster offen,
   *  in dem der Tab schon B zeigt, aber noch als A schreibt (oder umgekehrt). */
  const uebernimm = useCallback((b: BenutzerAnzeige | null) => {
    generation.current++;
    benutzerRef.current = b;
    setzeErwartetenBenutzer(b?.id ?? null);
    setBenutzer(b);
  }, []);

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
   *  von vor dem Wechsel bekommen haben, den der spätere Anstoß meldet. Während des Erstladens
   *  wird nur vorgemerkt: der Anstoß kann einen Wechsel melden, den das laufende Erstladen noch
   *  nicht sieht. */
  const pruefe = useCallback(
    function pruefeSelbst(): Promise<void> {
      if (laedtRef.current || laufendePruefung.current) {
        nachlaufNoetig.current = true;
        return laufendePruefung.current ?? Promise.resolve();
      }
      const lauf = (async () => {
        const angefragtIn = generation.current;
        const veraltet = () => {
          if (generation.current === angefragtIn) return false;
          nachlaufNoetig.current = true;
          return true;
        };
        let aufServer: BenutzerAnzeige;
        try {
          aufServer = await authApi.me();
        } catch (e) {
          if (veraltet()) return;
          // Keine gültige Sitzung: lokal abmelden, die Sitzungswache leitet mit Rückkehrziel zur
          // Anmeldung. Server nicht erreichbar (offline) oder sonstiger Fehler: nichts ändern.
          if (e instanceof ApiError && e.status === 401 && benutzerRef.current) {
            abmeldenLokal();
            meldeSitzungAbgelaufen();
          }
          return;
        }
        if (veraltet()) return;
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
    let aktiv = true;
    const angefragtIn = generation.current;
    // Nur übernehmen, wenn in der Zwischenzeit nichts anderes den Benutzer gesetzt hat — die
    // Anmeldeseite ist während des Erstladens bedienbar, ein Login kann schneller sein.
    const aktuell = () => aktiv && generation.current === angefragtIn;
    authApi
      .me()
      .then((b) => {
        if (aktuell()) uebernimm(b);
      })
      .catch((e) => {
        if (!aktuell()) return;
        // 401 = nicht angemeldet (erwartet); andere Fehler ebenfalls als „anonym" behandeln
        if (!(e instanceof ApiError)) console.error('Auth-Prüfung fehlgeschlagen', e);
        uebernimm(null);
      })
      .finally(() => {
        if (!aktiv) return;
        laedtRef.current = false;
        setLaedt(false);
        if (nachlaufNoetig.current) {
          nachlaufNoetig.current = false;
          void pruefe();
        }
      });
    return () => {
      aktiv = false;
      setzeErwartetenBenutzer(null);
    };
  }, [pruefe, uebernimm]);

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
      // Untagged Union: der MFA-Zweig ist am Feld `mfa_erforderlich` erkennbar. KEIN `setBenutzer`
      // — es gibt noch keine Session.
      if ('mfa_erforderlich' in antwort) {
        return { status: 'mfa_erforderlich' };
      }
      uebernimm(antwort);
      setKonflikt(null);
      // Neue gültige Sitzung → Melde-Sperre lösen, damit ein späterer Ablauf wieder gemeldet wird.
      sitzungsMeldungZuruecksetzen();
      meldeAuthWechsel({ art: 'angemeldet' });
      return { status: 'ok' };
    },
    [uebernimm],
  );

  /**
   * Meldet ab und wirft **nie** — die lokale Abmeldung darf nicht am Serverruf hängen.
   * Bliebe `benutzer` nach einem Fehler gesetzt, ließe `RequireAuth` geschützte Routen passieren,
   * und die Sitzungswache meldete wegen ihrer Sperre keinen Ablauf mehr. Lokal abgemeldet zu sein
   * ist in jedem Fall der sicherere Zustand. Ausnahme 412 (LFH-387): die Sitzung gehört jemand
   * anderem und bleibt bestehen; die 412 hat bereits die Prüfung angestoßen.
   */
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
    // Wie in `login`: Passkey- und TOTP-Login etablieren die Sitzung hierüber.
    sitzungsMeldungZuruecksetzen();
    meldeAuthWechsel({ art: 'angemeldet' });
  }, [uebernimm]);

  const wert = useMemo<AuthWert>(
    () => ({ benutzer, laedt, login, logout, aktualisiere, abmeldenLokal, konflikt }),
    [benutzer, laedt, login, logout, aktualisiere, abmeldenLokal, konflikt],
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
