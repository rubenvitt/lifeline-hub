import { http, HttpResponse } from 'msw';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { meHandler, server } from '../test/server';
import { neuerQueryClient } from '../test/utils';
import { AuthProvider, useAuth } from '../auth/AuthContext';
import { globalKeys } from '../api/queryKeys';
import { useZuletztBefehle } from './useZuletztBefehle';
import { SCHLUESSEL_ZULETZT_BEFEHLE } from './zuletztBefehle';
import type { BenutzerAnzeige, BenutzerEinstellungen } from '../api/types';
import { benutzerFixture } from '../test/fixtures';

const nutzer = benutzerFixture({ anzeigename: 'EL', org_rolle: 'fuehrungskraft' });

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

/** Kurzer Vorlauf in ECHTZEIT: für „es wurde NICHT geschrieben“ gibt es kein Ereignis zum
 *  Warten, und der msw-Handler schreibt erst einen Makrotask später. */
const flush = () =>
  new Promise((r) => {
    setTimeout(r, 40);
  });

/** Handler-Satz für den angemeldeten Fall. `serverStand` ist der Ausgangsinhalt des Fachs. */
function handler(serverStand: BenutzerEinstellungen) {
  return [
    meHandler(nutzer),
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
   * Die Antwort wird NICHT abgewartet: das Gedächtnis wird kurz vor dem Schließen der Palette
   * geschrieben und muss beim nächsten Öffnen schon im Cache stehen.
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
   * `CommandPalette.fuehreAus` ruft `schliesse()` VOR `ausfuehren()`, der Palettenbaum ist dann
   * abgehängt. Geprüft wird der Callback NACH dem Unmount seines Halters: er schreibt in den
   * QueryClient und schickt den Request selbst.
   */
  it('schreibt auch dann noch, wenn die haltende Komponente längst abgehängt ist', async () => {
    server.use(...handler(stand([])));
    const { client, Wrapper } = wrapper();
    const { result, unmount } = renderHook(() => useZuletztBefehle(), { wrapper: Wrapper });
    await waitFor(() => expect(gets).toBe(1));
    const merke = result.current.merke;
    // Ein zweiter, dauerhafter Beobachter steht für den Provider. Ohne ihn räumte `neuerQueryClient`
    // (`gcTime: 0`) den Eintrag beim Unmount weg. Seine Sitzung muss stehen, bevor der erste
    // abgehängt wird: der Key trägt die `benutzer.id`, und bis `/api/auth/me` zurück ist,
    // beobachtete er das Fach `[…, null]`.
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

  /** Ein abgelehnter Schreibvorgang darf nichts umwerfen; die Palette ist dann geschlossen. */
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
   * Ohne Sitzung wird nicht geholt: ein 401 liefe durch `meldeSitzungAbgelaufen()`, und die
   * Anmeldeseite meldete „Sitzung abgelaufen“.
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

    // Der Schreibweg holt bei leerem Cache selbst nach, ohne Sitzung aber nicht (401-Seam).
    act(() => {
      result.current.merke('nav:profil');
    });
    await flush();

    expect(gets).toBe(0);
    expect(puts).toEqual([]);
  });
});

/**
 * Der Server-Slot ist pro Benutzer, das Cache-Fach auch. Der Schichtwechsel am gemeinsamen
 * Fükw-Rechner läuft OHNE Neuladen (prozessweiter QueryClient), deshalb hier über
 * `logout()`/`login()` in DERSELBEN Montage; zwei frisch gerenderte Hooks wären auch mit einem
 * benutzerlosen Key grün.
 */
describe('useZuletztBefehle · Schichtwechsel ohne Neuladen', () => {
  /** Handler-Satz mit zwei Fächern; die „Sitzung" wechselt mit dem Login-Aufruf. */
  function zweiSchichten() {
    let sitzung: BenutzerAnzeige = nutzer;
    const faecher: Record<number, string[]> = { 1: ['nav:profil'], 2: ['koord:utm'] };
    return [
      meHandler(sitzung),
      http.post('/api/auth/logout', () => new HttpResponse(null, { status: 204 })),
      http.post('/api/auth/login', () => {
        sitzung = nutzerB;
        return HttpResponse.json(nutzerB);
      }),
      http.get('/api/benutzer-einstellungen', () => {
        gets += 1;
        // Das Fach hängt serverseitig AN DER SITZUNG, nie am Pfad; der Client trennt die beiden nur über
        // seinen Key.
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

  /** Die teurere Hälfte: ohne eigenes Fach schriebe die neue Schicht den Eintrag der alten
   *  dauerhaft in IHR Serverfach. */
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
 * Ein Schreibvorgang, der den Bestand nicht kennt, darf ihn nicht ersetzen: das PUT ist
 * VOLLERSATZ, aus einem leeren Cache gebildet ersetzte es alle gemerkten IDs.
 */
describe('useZuletztBefehle · Schreiben vor dem ersten Lesen', () => {
  /** GET, der erst auf Kommando antwortet. */
  function langsam(ids: string[]) {
    let loese: () => void = () => {};
    const frei = new Promise<void>((r) => {
      loese = r;
    });
    const handler = [
      meHandler(nutzer),
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
   * Die laufende Erst-Abfrage darf ihre Antwort nicht ÜBER den gerade gemerkten Befehl schreiben,
   * sonst löschte der nächste Schreibvorgang ihn auch auf dem Server.
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

    // Der NÄCHSTE Schreibvorgang trägt ihn weiter.
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

  /** Scheitert der GET, geht der eine Befehl verloren, der billigere Verlust: ein Vollersatz aus
   *  dem Nichts löschte alle gemerkten Befehle. */
  it('schreibt gar nicht, wenn der Bestand nicht zu laden ist', async () => {
    server.use(
      meHandler(nutzer),
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
