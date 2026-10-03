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
import { useQueryClient } from '@tanstack/react-query';
import type { BenutzerAnzeige } from '../api/types';
import { ApiError, NetzFehler, setzeErwartetenBenutzer } from '../api/client';
import * as authApi from '../api/auth';
import { abonniereAuthWechsel, meldeAuthWechsel } from './authKanal';
import {
  BENUTZER_PRUEFEN,
  meldeSitzungAbgelaufen,
  sitzungsMeldungZuruecksetzen,
} from './sitzungsEvent';
import { erfassungsSitzungBinden } from '../components/erfassungsSitzung';
import {
  lagebildAnmelden,
  lagebildBeenden,
  lagebildLoeschen,
  lagebildStarten,
} from '../offline/lagebildSitzung';
import type { MeErgebnis } from '../offline/lagebildStart';
import {
  geraetFuerBenutzerRaeumen,
  geraetRaeumen,
  type AusgangsAnlass,
} from '../offline/geraetRaeumung';
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
  /** Räumt nur den Zustand dieses Tabs, das Lagebild und die übrigen Gerätedaten (LFH-767),
   *  ohne Server-Logout (LFH-387) — für einen erkannten Sitzungsablauf; ein Server-Logout träfe
   *  eine inzwischen neu angelegte Sitzung. Der Anlass entscheidet über die ETB-Entwürfe: ein
   *  Sitzungsende behält sie, gebunden und befristet. Wirft nie. */
  abmeldenLokal: (anlass: AusgangsAnlass) => Promise<void>;
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
  const [konflikt, setKonflikt] = useState<BenutzerKonflikt | null>(null);
  const queryClient = useQueryClient();
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
  /** Ein anderer Tab hat FREIWILLIG abgemeldet (LFH-767): die nächste 401 der Prüfung räumt dann
   *  auch hier wie ein Abmelden, samt ETB-Entwürfen — sonst schriebe dieser Tab sie zurück. */
  const abmeldenAngekuendigt = useRef(false);

  /** Einziger Weg, den Benutzer zu setzen: hält den erwarteten Benutzer der Schreibanfragen
   *  (`api/client.ts`) synchron mit dem Zustand — ein Effekt ließe ein Render-Fenster offen,
   *  in dem der Tab schon B zeigt, aber noch als A schreibt (oder umgekehrt). Aus demselben
   *  Grund hier gebunden: die behaltenen Erfassungswerte (LFH-785), die eine Maske von B sonst
   *  mit denen von A vorbelegte. */
  const uebernimm = useCallback((b: BenutzerAnzeige | null) => {
    generation.current++;
    benutzerRef.current = b;
    setzeErwartetenBenutzer(b?.id ?? null);
    erfassungsSitzungBinden(b?.id ?? null);
    setBenutzer(b);
  }, []);

  /** Der Benutzer zuerst, das Lagebild (LFH-723, Speicher UND Platte) und die übrigen
   *  Gerätedaten (LFH-767) danach: ein Fehler beim Löschen darf die Abmeldung nicht aufhalten —
   *  sonst ließe `RequireAuth` geschützte Routen passieren und die Sitzungswache meldete wegen
   *  ihrer Sperre keinen Ablauf mehr. Der einzige Weg hinaus für beide. */
  const abmeldenLokal = useCallback(
    async (anlass: AusgangsAnlass) => {
      const warAngemeldet = benutzerRef.current !== null;
      uebernimm(null);
      setKonflikt(null);
      // Nur ein echter Wechsel wird gemeldet — sonst schaukelten sich die Tabs mit
      // „abgemeldet“ gegenseitig auf.
      if (warAngemeldet) meldeAuthWechsel({ art: 'abgemeldet', anlass });
      try {
        await lagebildLoeschen(queryClient);
      } catch (e) {
        console.error('Lagebild konnte beim Abmelden nicht gelöscht werden', e);
      }
      // Wirft nie; jeder Ort wird einzeln geräumt und protokolliert (offline/geraetRaeumung.ts).
      // NICHT abgewartet: hält ein Tab mit altem Bundle die Entwurfs-DB in v1 offen, hinge das
      // Upgrade — und mit ihm die Abmeldung. IndexedDB führt die Transaktionen trotzdem in
      // Auftragsreihenfolge aus, ein späteres Anmelden räumt erst danach.
      void geraetRaeumen(anlass);
    },
    [queryClient, uebernimm],
  );

  /** Nach jeder geklärten Anmeldung (LFH-767, design.md D4): Entwürfe und Quittungen anderer
   *  Personen gehen von der Platte. Das Räumen wird nicht abgewartet (s. `abmeldenLokal`) — die
   *  Entwürfe anderer blendet der Index bis dahin ohnehin aus. */
  const vorhaltungAnmelden = useCallback(
    async (b: BenutzerAnzeige) => {
      await lagebildAnmelden(queryClient, b);
      void geraetFuerBenutzerRaeumen(b.id);
    },
    [queryClient],
  );

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
            void abmeldenLokal(abmeldenAngekuendigt.current ? 'abmelden' : 'sitzungsende');
            abmeldenAngekuendigt.current = false;
            meldeSitzungAbgelaufen();
          }
          return;
        }
        abmeldenAngekuendigt.current = false;
        if (veraltet()) return;
        const lokal = benutzerRef.current;
        if (!lokal) {
          // In einem anderen Tab angemeldet, dieser Tab war anonym: übernehmen — wie ein Login,
          // mit dem Lagebild der neuen Person (LFH-723).
          await vorhaltungAnmelden(aufServer);
          if (veraltet()) return;
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
    [abmeldenLokal, uebernimm, vorhaltungAnmelden],
  );

  /**
   * Start: erst die Sitzungsprüfung, dann die Lagebild-Vorhaltung (LFH-723, design.md D2).
   *
   * Ohne Serverbestätigung (Netzfehler) bleibt `laedt` stehen, bis der vorgehaltene Stand im
   * Speicher ist — erst er sagt, WER angemeldet ist, und `RequireAuth` rendert bis dahin
   * nichts Geschütztes. Bei einem gültigen Stand ist die Person danach als der zuletzt
   * bestätigte Benutzer angemeldet, ohne Netz nur lesend. Ein Fremdstand erreicht den
   * Speicher nie: wiederhergestellt wird nur der Stand der bestätigten bzw. gespeicherten
   * Identität selbst.
   *
   * Jeder Schritt übernimmt nur, solange nichts anderes den Benutzer gesetzt hat (LFH-387) —
   * die Anmeldeseite ist währenddessen bedienbar, ein Login kann schneller sein.
   */
  useEffect(() => {
    let aktiv = true;
    let bestaetigt = false;
    let eigeneGeneration = generation.current;
    const aktuell = () => aktiv && generation.current === eigeneGeneration;
    const setze = (b: BenutzerAnzeige | null) => {
      uebernimm(b);
      eigeneGeneration = generation.current;
    };
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
        if (aktuell()) {
          setze(b);
          laedtRef.current = false;
          setLaedt(false);
        }
        return { art: 'ok', benutzer: b };
      }, meFehlerEinordnen)
      .then(async (me) => {
        const b = await lagebildStarten(queryClient, me, { abgebrochen: () => !aktuell() });
        // Serverbestätigt kommt derselbe Benutzer zurück; ohne Server ist es die Identität des
        // vorgehaltenen Stands oder niemand.
        if (!aktuell()) return;
        if (b?.id !== benutzerRef.current?.id) setze(b);
        // Gerätedaten (LFH-767). Lehnt der Server die Sitzung beim Start ab, ist das ein
        // Sitzungsende, das erst jetzt bemerkt wird — wie beim Lagebild geht dann, was der
        // Server wieder liefert. Ein Netzfehler sagt über die Sitzung nichts. Danach Fremdes
        // bzw. ohne Person Abgelaufenes (design.md D4). Wirft nie und wird nicht abgewartet
        // (s. `abmeldenLokal`).
        void (async () => {
          if (me.art === 'abgelehnt') await geraetRaeumen('sitzungsende');
          await geraetFuerBenutzerRaeumen(b?.id ?? null);
        })();
      })
      .catch((e: unknown) => {
        // Die Vorhaltung fängt ihre Speicherfehler selbst; was hier ankommt, ist unerwartet.
        // Eine bestätigte Sitzung bleibt davon unberührt — nur ohne Bestätigung gibt es dann
        // keinen Benutzer.
        console.error('Start der Sitzung fehlgeschlagen', e);
        if (aktuell() && !bestaetigt) setze(null);
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
      void lagebildBeenden(queryClient);
    };
  }, [pruefe, queryClient, uebernimm]);

  useEffect(() => {
    const anstossen = () => void pruefe();
    const beiSichtbarkeit = () => {
      if (document.visibilityState === 'visible') anstossen();
    };
    const abbestellen = abonniereAuthWechsel((wechsel) => {
      if (wechsel.art === 'abgemeldet' && wechsel.anlass === 'abmelden') {
        abmeldenAngekuendigt.current = true;
      }
      anstossen();
    });
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
      // Untagged Union: der MFA-Zweig ist am Feld `mfa_erforderlich` erkennbar. KEIN Benutzer
      // — es gibt noch keine Session.
      if ('mfa_erforderlich' in antwort) {
        return { status: 'mfa_erforderlich' };
      }
      // Eine andere Person als die vorherige räumt deren Lagebild und Gerätedaten (LFH-767),
      // bevor der Benutzer wechselt.
      await vorhaltungAnmelden(antwort);
      uebernimm(antwort);
      setKonflikt(null);
      // Neue gültige Sitzung → Melde-Sperre lösen, damit ein späterer Ablauf wieder gemeldet wird.
      sitzungsMeldungZuruecksetzen();
      meldeAuthWechsel({ art: 'angemeldet' });
      return { status: 'ok' };
    },
    [uebernimm, vorhaltungAnmelden],
  );

  /**
   * Meldet ab und wirft **nie** — die lokale Abmeldung darf nicht am Serverruf hängen.
   * Bliebe `benutzer` nach einem Fehler gesetzt, ließe `RequireAuth` geschützte Routen passieren,
   * und die Sitzungswache meldete wegen ihrer Sperre keinen Ablauf mehr. Lokal abgemeldet zu sein
   * ist in jedem Fall der sicherere Zustand; das Lagebild (LFH-723) geht mit. Ausnahme 412
   * (LFH-387): die Sitzung gehört jemand anderem und bleibt bestehen, samt ihrem Lagebild; die
   * 412 hat bereits die Prüfung angestoßen.
   */
  const logout = useCallback(async (): Promise<boolean> => {
    try {
      await authApi.logout();
    } catch (e) {
      if (e instanceof ApiError && e.status === 412) return false;
      console.error('Server-Abmeldung fehlgeschlagen — es wird trotzdem lokal abgemeldet', e);
    }
    await abmeldenLokal('abmelden');
    return true;
  }, [abmeldenLokal]);

  const aktualisiere = useCallback(async () => {
    const b = await authApi.me();
    await vorhaltungAnmelden(b);
    uebernimm(b);
    setKonflikt(null);
    // Wie in `login`: Passkey- und TOTP-Login etablieren die Sitzung hierüber.
    sitzungsMeldungZuruecksetzen();
    meldeAuthWechsel({ art: 'angemeldet' });
  }, [uebernimm, vorhaltungAnmelden]);

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
