import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import type { BenutzerAnzeige } from '../api/types';
import { freigabenFixture } from './fixtures';

/** `/api/auth/me` mit einem angemeldeten Benutzer — für `server.use(...)`. */
export function meHandler(benutzer: BenutzerAnzeige) {
  return http.get('/api/auth/me', () => HttpResponse.json(benutzer));
}

/**
 * Geteilte MSW-Server-Instanz; Handler werden pro Test via server.use() gesetzt.
 *
 * Die Default-Handler überleben `server.resetHandlers()`. `renderMitProviders` rendert einen
 * `<AuthProvider>`, der `/api/auth/me` abruft: 401 → anonym. Tests mit konkretem Benutzer
 * überschreiben per `server.use(http.get('/api/auth/me', …))`.
 */
export const server = setupServer(
  http.get('/api/auth/me', () => new HttpResponse(null, { status: 401 })),
  /**
   * Präferenzen des angemeldeten Benutzers — leeres Fach als Default. `CommandPaletteProvider`
   * fragt sie app-weit beim Mount ab; ohne Default bräuchte jede Testfläche mit angemeldetem
   * Benutzer den Handler. `{ eintraege: {} }` ist der echte Vorgabezustand des Servers.
   */
  http.get('/api/benutzer-einstellungen', () => HttpResponse.json({ eintraege: {} })),
  /**
   * Eigene ETB-Lesemarke — „nichts Neues" als Default (echter Serverzustand); die ETB-Seite
   * fragt sie beim Mount ab. Tests des Banners überschreiben per `server.use()`.
   */
  http.get('/api/einsaetze/:einsatzId/etb/lesemarke', () => HttpResponse.json({ neue_anzahl: 0 })),
  /**
   * Modulzähler des Navigationsrahmens — `{}` als Default („kein gezähltes Modul erlaubt", ein
   * echter Serverzustand). Tests der Zähler überschreiben per `server.use()`.
   */
  http.get('/api/einsaetze/:einsatzId/modul-zaehler', () => HttpResponse.json({})),
  /**
   * Modulfreigaben (LFH-669) — jedes Modul sichtbar und frei als Default: der echte Zustand eines
   * Einsatzes ohne Overrides und ohne Org-Vorgaben. Rahmen und jede Seite, die Daten eines
   * fremden Moduls lädt, fragen sie ab; Tests mit Sperren überschreiben per `server.use()`.
   */
  http.get('/api/einsaetze/:einsatzId/modul-freigaben', () =>
    HttpResponse.json(freigabenFixture()),
  ),
  /**
   * Gefahrengebiete — leere Liste als Default (LFH-397). Der Rahmen fragt sie für die
   * Warnsperre des Helligkeitsreglers beim Mount ab (`einsatz/useAktiveWarnung.ts`); `[]`
   * ist ein echter Serverzustand (kein Gebiet, keine Warnung). Tests mit Gebieten
   * überschreiben per `server.use()`.
   */
  http.get('/api/einsaetze/:einsatzId/gefahrengebiete', () => HttpResponse.json([])),
  /**
   * Dokumentenablage — leere Liste als Default (LFH-743). Die ETB-Seite fragt sie mit Freigabe
   * `dokumente` beim Mount ab, um Dokumente mit ETB-Bezug am Eintrag zu zeigen; `[]` ist ein
   * echter Serverzustand. Tests mit Dokumenten überschreiben per `server.use()`.
   */
  http.get('/api/einsaetze/:einsatzId/dokumente', () => HttpResponse.json([])),
  /**
   * Wetter — „kein Ort" als Default (LFH-663). Der Rahmen fragt es für Modulzähler und
   * Unwetterhinweis ab (`einsatz/useModulZaehler.ts`, `wetter/useUnwetterHinweis.ts`); „kein
   * Ort" ist ein echter Serverzustand ohne Zahl und ohne Hinweis. Tests mit Warnungen
   * überschreiben per `server.use()`.
   */
  http.get('/api/einsaetze/:einsatzId/wetter', () =>
    HttpResponse.json({
      warnungen: { zustand: 'kein_ort' },
      vorhersage: { zustand: 'kein_ort' },
    }),
  ),
  /**
   * Stammdaten der eigenen Organisation ohne Logo als Default; der Druckkopf fragt sie beim
   * Mount ab.
   */
  http.get('/api/organisation', () =>
    HttpResponse.json({ id: 1, name: 'Testorganisation', tz_organisation: null }),
  ),
  /**
   * Kräfte-Zeitachse (LFH-552) — „keine Ereignisse" als Default, ein echter Serverzustand.
   * Meldebild, Einheit-Detail und Personal-Seite fragen sie beim Mount ab; Tests mit Perioden
   * überschreiben per `server.use()`.
   */
  http.get('/api/einsaetze/:einsatzId/einheiten/zeitachse', () => HttpResponse.json([])),
  http.get('/api/einsaetze/:einsatzId/personal/zeitachse', () => HttpResponse.json([])),
  http.get('/api/einsaetze/:einsatzId/:modul/:kraftId/zeitachse', () =>
    HttpResponse.json({ ereignisse: [], perioden: [] }),
  ),
  /**
   * Org-Einstellungen: 403 als Default — der echte Zustand für Rollen ohne Leserecht. Der
   * `OrgAnzeigeProvider` (LFH-692) fragt sie außerhalb eines Einsatzes ab („Einsatz anlegen“,
   * Archivakte) und bleibt dann bei der Browserzone. Tests mit Zone überschreiben per
   * `server.use()`.
   */
  http.get('/api/org-einstellungen', () =>
    HttpResponse.json({ error: 'Keine Berechtigung' }, { status: 403 }),
  ),
  /**
   * Einsatz-Einstellungen: 403 als Default. Die Archivakte (LFH-692) fragt sie für ihre
   * Anzeigezone ab und fällt ohne Leserecht auf die Org-Zone zurück; Tests mit Einstellungen
   * überschreiben per `server.use()`.
   */
  http.get('/api/einsaetze/:einsatzId/einstellungen', () =>
    HttpResponse.json({ error: 'Kein Zugriff' }, { status: 403 }),
  ),
  /**
   * Demo-Daten: 404 als Default — der echte Zustand ohne `--demo-daten`, aus dem das Frontend
   * „nicht freigeschaltet“ liest. Einsatzliste und Verwaltung fragen ihn für jeden System-Admin ab.
   */
  http.get('/api/demo-daten', () =>
    HttpResponse.json({ error: 'Nicht gefunden' }, { status: 404 }),
  ),
  /**
   * Funktionskatalog (LFH-549) — leer als Default; Empfängerfelder und ETB-Vorschläge fragen ihn
   * beim Mount ab. Tests mit Katalog überschreiben per `server.use()` oder ersetzen den Hook.
   */
  http.get('/api/fuehrungsfunktionen', () => HttpResponse.json([])),
  /**
   * Stab eines Einsatzes — 403 als Default: der echte Zustand ohne Stab-Freigabe, aus dem die
   * Vorschläge „keine Besetzung lesbar“ machen. Tests des Stabs überschreiben per `server.use()`.
   */
  http.get('/api/einsaetze/:einsatzId/stab', () =>
    HttpResponse.json({ error: 'Keine Berechtigung' }, { status: 403 }),
  ),
);
