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
);
