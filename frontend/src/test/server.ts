import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

/** Geteilte MSW-Server-Instanz; Handler werden pro Test via server.use() gesetzt.
 *
 * Default-Handler bleiben nach `server.resetHandlers()` (afterEach) als Fallback erhalten:
 * Seit LFH-234 rendert `renderMitProviders` einen `<AuthProvider>`, der beim Mount
 * `/api/auth/me` abruft. 401 → benutzer=null (anonym, = Vor-Migrations-Verhalten für den
 * admin-globalen Schreibrecht-Zweig). Tests, die einen konkreten Benutzer (z. B. System-Admin)
 * brauchen, überschreiben das per `server.use(http.get('/api/auth/me', …))`.
 */
export const server = setupServer(
  http.get('/api/auth/me', () => new HttpResponse(null, { status: 401 })),
  /**
   * Präferenzen des angemeldeten Benutzers (LFH-391 · Etappe D) — leeres Fach als Default.
   *
   * Aus demselben Grund hier wie `/api/auth/me`: `CommandPaletteProvider` fragt sie APP-WEIT
   * beim Mount ab, sobald ein Benutzer angemeldet ist (das Befehls-Gedächtnis muss vor dem
   * ersten Öffnen der Palette dastehen, sonst klappt die oberste Gruppe sichtbar nach). Jede
   * der rund zwanzig Testflächen, die den Provider mit einem angemeldeten Benutzer mounten,
   * müsste den Handler sonst einzeln mitbringen — für eine Abfrage, mit der ihr Gegenstand
   * nichts zu tun hat.
   *
   * `{ eintraege: {} }` ist der ECHTE Vorgabezustand des Servers („noch nie geschrieben",
   * kein 404 und ohne `geaendert_at`), keine Attrappe. Tests, die ein gefülltes Gedächtnis
   * brauchen, überschreiben per `server.use()`.
   */
  http.get('/api/benutzer-einstellungen', () => HttpResponse.json({ eintraege: {} })),
  /**
   * Eigene ETB-Lesemarke (LFH-611) — „nichts Neues" als Default. Die ETB-Seite fragt sie beim
   * Mount ab; jede Testfläche, die die Seite rendert, müsste den Handler sonst mitbringen, für
   * ein Banner, mit dem ihr Gegenstand nichts zu tun hat. `{ neue_anzahl: 0 }` ist ein echter
   * Serverzustand (leeres Tagebuch bzw. nur eigene Einträge), keine Attrappe; das Banner
   * schweigt dazu. Tests des Banners überschreiben per `server.use()`.
   */
  http.get('/api/einsaetze/:einsatzId/etb/lesemarke', () => HttpResponse.json({ neue_anzahl: 0 })),
  /**
   * Modulzähler des Navigationsrahmens (LFH-612) — leere Antwort als Default. Der Rahmen
   * fragt sie beim Mount ab; `{}` heißt „kein gezähltes Modul erlaubt" und ist ein echter
   * Serverzustand, keine Attrappe mit erfundenen Zahlen: kein Modul zeigt dann eine Zahl.
   * Tests der Zähler überschreiben per `server.use()`.
   */
  http.get('/api/einsaetze/:einsatzId/modul-zaehler', () => HttpResponse.json({})),
  /**
   * Stammdaten der eigenen Organisation (LFH-22) — ohne Logo als Default. Der Druckkopf
   * (`components/druck/Druckkopf.tsx`) fragt sie beim Mount ab, und er steht auf Befehl,
   * Lagebericht, Meldebild und ETB-Druck; jede dieser Testflächen müsste den Handler sonst
   * mitbringen. Eine Organisation mit Namen und ohne Logo ist ein echter Serverzustand.
   */
  http.get('/api/organisation', () =>
    HttpResponse.json({ id: 1, name: 'Testorganisation', tz_organisation: null }),
  ),
  /**
   * Status der Demo-Daten (LFH-690) — 404 als Default. Das ist der ECHTE Serverzustand ohne
   * `--demo-daten`: die Routen sind dann gar nicht registriert (design.md D1/D2), und das
   * Frontend liest genau daraus „nicht freigeschaltet“. Die Einsatzliste und die Verwaltung
   * fragen ihn für jeden System-Admin ab; ohne diesen Handler fielen deren Tests an
   * `onUnhandledRequest: 'error'`. Tests der Freischaltung überschreiben per `server.use()`.
   */
  http.get('/api/demo-daten', () =>
    HttpResponse.json({ error: 'Nicht gefunden' }, { status: 404 }),
  ),
);
