// frontend/src/command-palette/useZuletztBefehle.test.tsx
import { http, HttpResponse } from 'msw';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { server } from '../test/server';
import { neuerQueryClient } from '../test/utils';
import { AuthProvider, useAuth } from '../auth/AuthContext';
import { globalKeys } from '../api/queryKeys';
import { useZuletztBefehle } from './useZuletztBefehle';
import { SCHLUESSEL_ZULETZT_BEFEHLE } from './zuletztBefehle';
import type { BenutzerEinstellungen } from '../api/types';

const nutzer = {
  id: 1,
  anzeigename: 'EL',
  benutzername: 'el',
  system_rolle: 'keiner',
  org_rolle: 'fuehrungskraft',
  aktiv: true,
  erstellt_at: '',
  totp_aktiviert: false,
};

/** Die zweite Schicht am selben Rechner — andere `id`, sonst gleich gebaut. */
const nutzerB = { ...nutzer, id: 2, anzeigename: 'S2', benutzername: 's2' };

/** Was der Server auf PUT entgegennimmt — je Test ausgelesen. */
let puts: { schluessel: string; wert: string }[];
/** Wie oft das Fach überhaupt GELESEN wurde (für die Aussage „ohne Sitzung gar nicht"). */
let gets: number;

function stand(ids: string[]): BenutzerEinstellungen {
  return { eintraege: { [SCHLUESSEL_ZULETZT_BEFEHLE]: JSON.stringify(ids) } };
}

beforeEach(() => {
  puts = [];
  gets = 0;
});

/** Der PUT-Handler ist in allen Fassungen derselbe — er quittiert mit genau dem Fach,
 *  das er entgegengenommen hat. */
const putHandler = () =>
  http.put('/api/benutzer-einstellungen/:schluessel', async ({ params, request }) => {
    const body = (await request.json()) as { wert: string };
    puts.push({ schluessel: String(params.schluessel), wert: body.wert });
    return HttpResponse.json({ eintraege: { [String(params.schluessel)]: body.wert } });
  });

/** Kurzer Vorlauf in ECHTZEIT. Für die Negativaussagen „es wurde NICHT geschrieben" gibt es
 *  kein Ereignis, auf das `waitFor` warten könnte — ohne diesen Vorlauf wäre `puts` auch bei
 *  kaputter Fassung noch leer, weil der msw-Handler erst einen Makrotask später schreibt. */
const flush = () =>
  new Promise((r) => {
    setTimeout(r, 40);
  });

/** Handler-Satz für den angemeldeten Fall. `serverStand` ist der Ausgangsinhalt des Fachs. */
function handler(serverStand: BenutzerEinstellungen) {
  return [
    http.get('/api/auth/me', () => HttpResponse.json(nutzer)),
    http.get('/api/benutzer-einstellungen', () => {
      gets += 1;
      return HttpResponse.json(serverStand);
    }),
    http.put('/api/benutzer-einstellungen/:schluessel', async ({ params, request }) => {
      const body = (await request.json()) as { wert: string };
      puts.push({ schluessel: String(params.schluessel), wert: body.wert });
      return HttpResponse.json({ eintraege: { [String(params.schluessel)]: body.wert } });
    }),
  ];
}

function wrapper() {
  const client = neuerQueryClient();
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <AuthProvider>{children}</AuthProvider>
    </QueryClientProvider>
  );
  return { client, Wrapper };
}

describe('useZuletztBefehle', () => {
  it('liest die gemerkten IDs aus dem Serverstand', async () => {
    server.use(...handler(stand(['nav:profil', 'koord:utm'])));
    const { Wrapper } = wrapper();

    const { result } = renderHook(() => useZuletztBefehle(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.ids).toEqual(['nav:profil', 'koord:utm']));
  });

  /**
   * DIE ANTWORT WIRD NICHT ABGEWARTET. Der Stand liegt sofort im Cache, weil er sonst erst
   * nach dem Netzweg sichtbar würde — und das Gedächtnis wird EINEN Wimpernschlag vor dem
   * Schliessen der Palette geschrieben. Wäre die Anzeige an die Antwort gebunden, fehlte
   * der Eintrag beim nächsten Öffnen, ohne Fehlermeldung.
   */
  it('nimmt den Befehl sofort auf und schickt ihn hinterher', async () => {
    server.use(...handler(stand(['koord:utm'])));
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useZuletztBefehle(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.ids).toEqual(['koord:utm']));

    result.current.merke('nav:profil');

    await waitFor(() => expect(result.current.ids).toEqual(['nav:profil', 'koord:utm']));
    await waitFor(() =>
      expect(puts).toEqual([
        { schluessel: SCHLUESSEL_ZULETZT_BEFEHLE, wert: '["nav:profil","koord:utm"]' },
      ]),
    );
  });

  /**
   * FALLE (a) auf Hook-Ebene: `CommandPalette.fuehreAus` ruft `schliesse()` VOR
   * `ausfuehren()`, und `destroyOnHidden` hängt den Teilbaum ab, in dem die Palette lebt.
   * Ein Träger mit Komponentenbindung (`useMutation` im abgehängten Baum) verlöre den
   * Eintrag genau hier — lautlos.
   *
   * Geprüft wird deshalb der Callback NACH dem Unmount seines Halters: er schreibt in den
   * QueryClient (der lebt an der Wurzel) und schickt den Request selbst.
   */
  it('schreibt auch dann noch, wenn die haltende Komponente längst abgehängt ist', async () => {
    server.use(...handler(stand([])));
    const { client, Wrapper } = wrapper();
    const { result, unmount } = renderHook(() => useZuletztBefehle(), { wrapper: Wrapper });
    await waitFor(() => expect(gets).toBe(1));
    const merke = result.current.merke;
    // Ein zweiter, dauerhafter Beobachter — er steht für den Provider, der in der Produktion
    // die Palette überlebt. OHNE ihn räumt `neuerQueryClient` (`gcTime: 0`) den Eintrag beim
    // Unmount des letzten Beobachters sofort weg, und die Cache-Aussage unten wäre nicht
    // „nicht geschrieben", sondern „nicht mehr da" (CLAUDE.md, Query-Key-Testfallen).
    // SEINE SITZUNG MUSS STEHEN, bevor der erste abgehängt wird: der Key trägt die
    // `benutzer.id`, und `renderHook` gibt jedem Aufruf einen EIGENEN `AuthProvider` — bis
    // dessen `/api/auth/me` zurück ist, beobachtet der zweite Hook das Fach `[…, null]` und
    // nicht das des Benutzers. Gemessen: ohne dieses Warten stand das Fach zwischenzeitlich
    // ohne Beobachter da, wurde weggeräumt und danach frisch vom Server geholt.
    const bleibt = renderHook(() => ({ auth: useAuth(), g: useZuletztBefehle() }), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(bleibt.result.current.auth.benutzer).not.toBeNull());

    unmount();
    merke('nav:profil');

    await waitFor(() =>
      expect(puts).toEqual([{ schluessel: SCHLUESSEL_ZULETZT_BEFEHLE, wert: '["nav:profil"]' }]),
    );
    expect(client.getQueryData(globalKeys.benutzerEinstellungenVon(nutzer.id))).toEqual(
      stand(['nav:profil']),
    );
    bleibt.unmount();
  });

  /** Ein abgelehnter Schreibvorgang darf nichts umwerfen: die Palette ist zu diesem
   *  Zeitpunkt geschlossen, es gibt keine Fläche, auf der ein Fehler stünde. */
  it('verschluckt einen abgelehnten Schreibvorgang, ohne den Stand zu verlieren', async () => {
    server.use(
      ...handler(stand([])),
      http.put('/api/benutzer-einstellungen/:schluessel', () =>
        HttpResponse.json({ error: 'Unbekannter Einstellungs-Schlüssel' }, { status: 400 }),
      ),
    );
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useZuletztBefehle(), { wrapper: Wrapper });
    await waitFor(() => expect(gets).toBe(1));

    result.current.merke('nav:profil');

    await waitFor(() => expect(result.current.ids).toEqual(['nav:profil']));
  });

  /**
   * Ohne Sitzung wird gar nicht erst geholt. Das ist keine Sparsamkeit: ein 401 auf einer
   * Query läuft in `queryClient.ts` durch `meldeSitzungAbgelaufen()` — die Anmeldeseite
   * bekäme beim blossen Laden die Meldung „Sitzung abgelaufen".
   */
  it('holt ohne angemeldeten Benutzer nichts — auch nicht über einen Schreibvorgang', async () => {
    // Kein `/api/auth/me`-Handler → der Default liefert 401 → benutzer = null.
    server.use(
      http.get('/api/benutzer-einstellungen', () => {
        gets += 1;
        return HttpResponse.json(stand([]));
      }),
      putHandler(),
    );
    const { Wrapper } = wrapper();

    const { result } = renderHook(() => useZuletztBefehle(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.ids).toEqual([]));
    expect(gets).toBe(0);

    // Der Schreibweg holt seit dem Bestands-Riegel selbst nach, wenn der Cache leer ist —
    // ohne Sitzung darf er das NICHT: der 401 liefe in `queryClient.ts` durch
    // `meldeSitzungAbgelaufen()`, und die Anmeldeseite bekäme „Sitzung abgelaufen" ohne Anlass.
    act(() => {
      result.current.merke('nav:profil');
    });
    await flush();

    expect(gets).toBe(0);
    expect(puts).toEqual([]);
  });
});

/**
 * DER SERVER-SLOT IST PRO BENUTZER, sein Cache-Fach muss es auch sein (Review-Befund zu
 * Etappe D, von zwei Prüfern unabhängig gefunden).
 *
 * Der Fall, der zählt, ist der Schichtwechsel am gemeinsamen Fükw-Rechner OHNE Neuladen:
 * `LoginPage` navigiert nur, und `main.tsx` hält einen prozessweiten QueryClient. Deshalb
 * läuft der Wechsel hier über `useAuth().logout()`/`login()` in DERSELBEN Montage — ein
 * Test, der zwei Hooks nacheinander frisch rendert, prüfte etwas anderes und wäre auch mit
 * einem benutzerlosen Key grün.
 */
describe('useZuletztBefehle · Schichtwechsel ohne Neuladen', () => {
  /** Handler-Satz mit zwei Fächern; die „Sitzung" wechselt mit dem Login-Aufruf. */
  function zweiSchichten() {
    let sitzung = nutzer;
    const faecher: Record<number, string[]> = { 1: ['nav:profil'], 2: ['koord:utm'] };
    return [
      http.get('/api/auth/me', () => HttpResponse.json(sitzung)),
      http.post('/api/auth/logout', () => new HttpResponse(null, { status: 204 })),
      http.post('/api/auth/login', () => {
        sitzung = nutzerB;
        return HttpResponse.json(nutzerB);
      }),
      http.get('/api/benutzer-einstellungen', () => {
        gets += 1;
        // Das Fach hängt serverseitig AN DER SITZUNG, nie am Pfad — genau deshalb kann der
        // Client die beiden nur über seinen eigenen Key auseinanderhalten.
        return HttpResponse.json(stand(faecher[sitzung.id]));
      }),
      putHandler(),
    ];
  }

  async function wechsle(result: {
    current: {
      auth: { logout: () => Promise<void>; login: (a: string, b: string) => Promise<unknown> };
    };
  }) {
    await act(async () => {
      await result.current.auth.logout();
    });
    await act(async () => {
      await result.current.auth.login('s2', 'geheim');
    });
  }

  it('zeigt nach dem Wechsel das Fach der NEUEN Schicht, nicht das der alten', async () => {
    server.use(...zweiSchichten());
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => ({ auth: useAuth(), g: useZuletztBefehle() }), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.g.ids).toEqual(['nav:profil']));

    await wechsle(result);

    await waitFor(() => expect(result.current.g.ids).toEqual(['koord:utm']));
  });

  /** Die teurere Hälfte: ohne eigenes Fach schreibt der erste Griff der neuen Schicht den
   *  Eintrag der alten in IHR Serverfach — und dort steht er dann dauerhaft. */
  it('schreibt den ersten Befehl der neuen Schicht auf DEREN Bestand', async () => {
    server.use(...zweiSchichten());
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => ({ auth: useAuth(), g: useZuletztBefehle() }), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.g.ids).toEqual(['nav:profil']));

    await wechsle(result);
    await waitFor(() => expect(result.current.g.ids).toEqual(['koord:utm']));
    act(() => {
      result.current.g.merke('nav:admin');
    });

    await waitFor(() =>
      expect(puts).toEqual([
        { schluessel: SCHLUESSEL_ZULETZT_BEFEHLE, wert: '["nav:admin","koord:utm"]' },
      ]),
    );
  });
});

/**
 * EIN SCHREIBVORGANG, DER DEN BESTAND NICHT KENNT, DARF IHN NICHT ERSETZEN (Review-Befunde 3
 * und 4 zu Etappe D — dieselbe Naht zwischen Abfrage, Cache und Schreibvorgang).
 *
 * Das PUT ist VOLLERSATZ. Aus einem leeren Cache gebildet ersetzt es die fünf gemerkten IDs
 * durch die eine gerade ausgeführte — stumm, ohne Fehlerbild, und dauerhaft, wenn der GET
 * scheitert.
 */
describe('useZuletztBefehle · Schreiben vor dem ersten Lesen', () => {
  /** GET, der erst auf Kommando antwortet. */
  function langsam(ids: string[]) {
    let loese: () => void = () => {};
    const frei = new Promise<void>((r) => {
      loese = r;
    });
    const handler = [
      http.get('/api/auth/me', () => HttpResponse.json(nutzer)),
      http.get('/api/benutzer-einstellungen', async () => {
        gets += 1;
        await frei;
        return HttpResponse.json(stand(ids));
      }),
      putHandler(),
    ];
    return { handler, loese: () => loese() };
  }

  it('schreibt nichts, solange der Bestand noch unterwegs ist — und danach den VOLLEN', async () => {
    const { handler, loese } = langsam(['koord:utm', 'koord:dms', 'nav:profil']);
    server.use(...handler);
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useZuletztBefehle(), { wrapper: Wrapper });
    await waitFor(() => expect(gets).toBe(1));

    act(() => {
      result.current.merke('nav:admin');
    });
    await flush();

    expect(puts, 'ein unbekannter Bestand darf nicht ersetzt werden').toEqual([]);

    loese();

    await waitFor(() =>
      expect(puts).toEqual([
        {
          schluessel: SCHLUESSEL_ZULETZT_BEFEHLE,
          wert: '["nav:admin","koord:utm","koord:dms","nav:profil"]',
        },
      ]),
    );
  });

  /**
   * Befund 4, dieselbe Wurzel: die noch laufende Erst-Abfrage schrieb ihre Antwort ÜBER den
   * gerade gemerkten Befehl (react-query setzt den Serverstand in den Cache), und der nächste
   * Schreibvorgang las den geräumten Cache und löschte ihn dann auch auf dem Server.
   */
  it('lässt die eintreffende Erst-Antwort den gemerkten Befehl nicht überschreiben', async () => {
    const { handler, loese } = langsam(['koord:utm']);
    server.use(...handler);
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useZuletztBefehle(), { wrapper: Wrapper });
    await waitFor(() => expect(gets).toBe(1));

    act(() => {
      result.current.merke('nav:admin');
    });
    loese();

    await waitFor(() => expect(result.current.ids).toEqual(['nav:admin', 'koord:utm']));

    // Und der NÄCHSTE Schreibvorgang trägt ihn weiter, statt ihn zu löschen.
    act(() => {
      result.current.merke('nav:stammdaten');
    });
    await waitFor(() =>
      expect(puts[puts.length - 1]).toEqual({
        schluessel: SCHLUESSEL_ZULETZT_BEFEHLE,
        wert: '["nav:stammdaten","nav:admin","koord:utm"]',
      }),
    );
  });

  /** Scheitert der GET, ist der Bestand DAUERHAFT unbekannt. Dann geht der eine Befehl
   *  verloren — das ist der billigere Verlust: ein Vollersatz aus dem Nichts löschte die
   *  gemerkten Befehle auf dem Server, und die kommen nicht wieder. */
  it('schreibt gar nicht, wenn der Bestand nicht zu laden ist', async () => {
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(nutzer)),
      http.get('/api/benutzer-einstellungen', () => {
        gets += 1;
        return HttpResponse.json({ error: 'kaputt' }, { status: 500 });
      }),
      putHandler(),
    );
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useZuletztBefehle(), { wrapper: Wrapper });
    await waitFor(() => expect(gets).toBe(1));

    act(() => {
      result.current.merke('nav:admin');
    });
    await flush();

    expect(puts).toEqual([]);
    expect(result.current.ids).toEqual([]);
  });
});
