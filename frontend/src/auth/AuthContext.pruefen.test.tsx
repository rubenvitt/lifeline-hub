/**
 * LFH-387: der AuthProvider prüft seinen Benutzer gegen den Server, wenn ein anderer Tab einen
 * Wechsel meldet, eine Schreibanfrage mit 412 abgelehnt wurde oder der Tab wieder sichtbar wird.
 *
 * Bewusst mit nacktem `render` statt `renderMitProviders`: der Test-Rahmen bringt selbst einen
 * AuthProvider mit, und zwei Provider prüften hier gleichzeitig.
 */
import { http, HttpResponse } from 'msw';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../test/server';
import { ERWARTETER_BENUTZER_HEADER, apiSend, setzeErwartetenBenutzer } from '../api/client';
import { AuthProvider, useAuth } from './AuthContext';
import type { AuthWechsel } from './authKanal';
import {
  BENUTZER_PRUEFEN,
  SITZUNG_ABGELAUFEN,
  sitzungsMeldungZuruecksetzen,
} from './sitzungsEvent';

const anna = {
  id: 1,
  anzeigename: 'Anna Admin',
  benutzername: 'anna',
  system_rolle: 'admin',
  org_rolle: 'keine',
  aktiv: true,
  erstellt_at: '2026-05-23 10:00:00',
};
const bruno = { ...anna, id: 2, anzeigename: 'Bruno Beispiel', benutzername: 'bruno' };

/** Wem die Sitzung auf dem Server gerade gehört; `null` = keine gültige Sitzung (401),
 *  `'netz'` = Server nicht erreichbar. */
let sitzung: typeof anna | null | 'netz';
let meAufrufe: number;
let logoutAufrufe: number;

beforeEach(() => {
  sitzung = anna;
  meAufrufe = 0;
  logoutAufrufe = 0;
  server.use(
    http.get('/api/auth/me', () => {
      meAufrufe++;
      if (sitzung === 'netz') return HttpResponse.error();
      if (sitzung === null) return HttpResponse.json({ error: 'x' }, { status: 401 });
      return HttpResponse.json(sitzung);
    }),
    http.post('/api/auth/logout', ({ request }) => {
      logoutAufrufe++;
      const erwartet = request.headers.get(ERWARTETER_BENUTZER_HEADER);
      if (sitzung !== null && sitzung !== 'netz' && erwartet && Number(erwartet) !== sitzung.id) {
        return HttpResponse.json({ error: 'fremd' }, { status: 412 });
      }
      sitzung = null;
      return new HttpResponse(null, { status: 204 });
    }),
    http.post('/api/auth/login', () => {
      sitzung = anna;
      return HttpResponse.json(anna);
    }),
  );
});

afterEach(() => {
  sitzungsMeldungZuruecksetzen();
  setzeErwartetenBenutzer(null);
  vi.restoreAllMocks();
});

let ergebnisLogout: boolean | undefined;

function Sonde() {
  const { benutzer, laedt, konflikt, login, logout, weiterAls } = useAuth();
  if (laedt) return <div>lädt…</div>;
  return (
    <div>
      <span data-testid="name">{benutzer ? benutzer.anzeigename : 'anonym'}</span>
      <span data-testid="konflikt">
        {konflikt ? `${konflikt.bisher.anzeigename}→${konflikt.jetzt.anzeigename}` : '—'}
      </span>
      <button onClick={() => void login('anna', 'pw')}>login</button>
      <button onClick={() => void logout().then((ab) => (ergebnisLogout = ab))}>logout</button>
      <button onClick={weiterAls}>weiter</button>
    </div>
  );
}

async function starte(erwartet = 'Anna Admin') {
  render(
    <AuthProvider>
      <Sonde />
    </AuthProvider>,
  );
  await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent(erwartet));
}

const pruefenAnstossen = () => act(() => void window.dispatchEvent(new Event(BENUTZER_PRUEFEN)));

/** Schreibt über den echten Client und liefert den mitgeschickten erwarteten Benutzer. */
async function kopfBeimSchreiben(): Promise<string | null> {
  let kopf: string | null = null;
  server.use(
    http.post('/api/sonde', ({ request }) => {
      kopf = request.headers.get(ERWARTETER_BENUTZER_HEADER);
      return HttpResponse.json({});
    }),
  );
  await apiSend('/api/sonde', 'POST', {});
  return kopf;
}

describe('AuthProvider prüft den Benutzer (LFH-387)', () => {
  it('setzt nach dem Erstladen den erwarteten Benutzer für Schreibanfragen', async () => {
    await starte();
    expect(await kopfBeimSchreiben()).toBe('1');
  });

  it('gleicher Benutzer: keine Änderung', async () => {
    await starte();
    const vorher = meAufrufe;
    pruefenAnstossen();
    await waitFor(() => expect(meAufrufe).toBe(vorher + 1));
    expect(screen.getByTestId('name')).toHaveTextContent('Anna Admin');
    expect(screen.getByTestId('konflikt')).toHaveTextContent('—');
  });

  it('Tab ohne Benutzer übernimmt eine Sitzung aus einem anderen Tab', async () => {
    sitzung = null;
    await starte('anonym');
    sitzung = anna;
    pruefenAnstossen();
    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent('Anna Admin'));
    expect(await kopfBeimSchreiben()).toBe('1');
  });

  it('Sitzung eines anderen Benutzers: Konflikt, der Tab bleibt beim bisherigen Benutzer', async () => {
    await starte();
    sitzung = bruno;
    pruefenAnstossen();
    await waitFor(() =>
      expect(screen.getByTestId('konflikt')).toHaveTextContent('Anna Admin→Bruno Beispiel'),
    );
    expect(screen.getByTestId('name')).toHaveTextContent('Anna Admin');
    // Solange der Konflikt steht, schreibt der Tab weiter als Anna — der Server lehnt ab.
    expect(await kopfBeimSchreiben()).toBe('1');
  });

  it('„weiter als“ übernimmt den neuen Benutzer und löst den Konflikt', async () => {
    await starte();
    sitzung = bruno;
    pruefenAnstossen();
    await waitFor(() => expect(screen.getByTestId('konflikt')).not.toHaveTextContent('—'));
    await userEvent.click(screen.getByText('weiter'));
    expect(screen.getByTestId('name')).toHaveTextContent('Bruno Beispiel');
    expect(screen.getByTestId('konflikt')).toHaveTextContent('—');
    expect(await kopfBeimSchreiben()).toBe('2');
  });

  it('Konflikt löst sich, wenn die Sitzung wieder dem bisherigen Benutzer gehört', async () => {
    await starte();
    sitzung = bruno;
    pruefenAnstossen();
    await waitFor(() => expect(screen.getByTestId('konflikt')).not.toHaveTextContent('—'));
    sitzung = anna;
    pruefenAnstossen();
    await waitFor(() => expect(screen.getByTestId('konflikt')).toHaveTextContent('—'));
    expect(screen.getByTestId('name')).toHaveTextContent('Anna Admin');
  });

  it('keine gültige Sitzung: lokal abmelden und den Ablauf melden, ohne Server-Logout', async () => {
    await starte();
    const ablauf = vi.fn();
    window.addEventListener(SITZUNG_ABGELAUFEN, ablauf);
    try {
      sitzung = null;
      pruefenAnstossen();
      await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent('anonym'));
      expect(ablauf).toHaveBeenCalledTimes(1);
      expect(logoutAufrufe).toBe(0);
      expect(await kopfBeimSchreiben()).toBeNull();
    } finally {
      window.removeEventListener(SITZUNG_ABGELAUFEN, ablauf);
    }
  });

  it('Server nicht erreichbar: keine Änderung (offline)', async () => {
    await starte();
    const vorher = meAufrufe;
    sitzung = 'netz';
    pruefenAnstossen();
    await waitFor(() => expect(meAufrufe).toBe(vorher + 1));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByTestId('name')).toHaveTextContent('Anna Admin');
    expect(screen.getByTestId('konflikt')).toHaveTextContent('—');
  });

  it('prüft beim Wieder-Sichtbarwerden des Tabs', async () => {
    await starte();
    sitzung = bruno;
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    await waitFor(() => expect(screen.getByTestId('konflikt')).not.toHaveTextContent('—'));
  });

  it('prüft auf eine Meldung aus einem anderen Tab', async () => {
    await starte();
    sitzung = bruno;
    const andererTab = new BroadcastChannel('lfh-auth');
    try {
      andererTab.postMessage({ art: 'angemeldet' } satisfies AuthWechsel);
      await waitFor(() =>
        expect(screen.getByTestId('konflikt')).toHaveTextContent('Anna Admin→Bruno Beispiel'),
      );
    } finally {
      andererTab.close();
    }
  });

  it('prüft auf eine 412-Antwort einer Schreibanfrage', async () => {
    await starte();
    sitzung = bruno;
    server.use(http.post('/api/sonde', () => HttpResponse.json({ error: 'x' }, { status: 412 })));
    await expect(apiSend('/api/sonde', 'POST', {})).rejects.toMatchObject({ status: 412 });
    await waitFor(() => expect(screen.getByTestId('konflikt')).not.toHaveTextContent('—'));
    expect(screen.getByTestId('name')).toHaveTextContent('Anna Admin');
  });

  it('fasst gleichzeitige Anstöße zusammen: ein Lauf plus höchstens ein Nachlauf', async () => {
    await starte();
    const vorher = meAufrufe;
    act(() => {
      for (let i = 0; i < 5; i++) window.dispatchEvent(new Event(BENUTZER_PRUEFEN));
    });
    await waitFor(() => expect(meAufrufe).toBe(vorher + 2));
    await new Promise((r) => setTimeout(r, 30));
    expect(meAufrufe).toBe(vorher + 2);
  });
});

describe('Zwei Tabs, schneller Wechsel (LFH-387)', () => {
  // „Tab 2“ ist ein eigenes Kanalobjekt plus der Sitzungswechsel auf dem Server: innerhalb
  // eines Realms teilen sich zwei AuthProvider EIN Kanalobjekt (kein Selbst-Echo, s.
  // authKanal.ts) und hörten einander deshalb nicht. Echte zwei Tabs: e2e/sitzung-mehrere-tabs.

  it('Wechsel A→B in Tab 2 ohne Abmelden: Tab 1 zeigt den Konflikt', async () => {
    await starte();
    const tab2 = new BroadcastChannel('lfh-auth');
    try {
      sitzung = bruno;
      tab2.postMessage({ art: 'angemeldet' } satisfies AuthWechsel);
      await waitFor(() =>
        expect(screen.getByTestId('konflikt')).toHaveTextContent('Anna Admin→Bruno Beispiel'),
      );
      expect(screen.getByTestId('name')).toHaveTextContent('Anna Admin');
    } finally {
      tab2.close();
    }
  });

  it('ein Anstoß während einer laufenden Prüfung geht nicht verloren', async () => {
    await starte();
    // Die erste Prüfung hängt am Server, bis der zweite Anstoß da ist; sie sieht noch Anna.
    let freigeben: () => void = () => {};
    const gesperrt = new Promise<void>((r) => (freigeben = r));
    let ersteAntwort = true;
    server.use(
      http.get('/api/auth/me', async () => {
        meAufrufe++;
        if (ersteAntwort) {
          ersteAntwort = false;
          await gesperrt;
          return HttpResponse.json(anna);
        }
        return HttpResponse.json(sitzung as typeof anna);
      }),
    );
    const vorher = meAufrufe;
    pruefenAnstossen();
    await waitFor(() => expect(meAufrufe).toBe(vorher + 1));
    sitzung = bruno;
    pruefenAnstossen();
    freigeben();
    await waitFor(() =>
      expect(screen.getByTestId('konflikt')).toHaveTextContent('Anna Admin→Bruno Beispiel'),
    );
    expect(meAufrufe).toBe(vorher + 2);
  });
});

describe('An- und Abmelden über mehrere Tabs (LFH-387)', () => {
  function mithoeren() {
    const gehoert: AuthWechsel[] = [];
    const kanal = new BroadcastChannel('lfh-auth');
    kanal.onmessage = (e: MessageEvent<AuthWechsel>) => gehoert.push(e.data);
    return { gehoert, schliessen: () => kanal.close() };
  }

  it('Logout aus einem veralteten Tab (412) meldet nicht ab, sondern zeigt den Konflikt', async () => {
    await starte();
    sitzung = bruno;
    ergebnisLogout = undefined;
    await userEvent.click(screen.getByText('logout'));
    await waitFor(() => expect(ergebnisLogout).toBe(false));
    expect(screen.getByTestId('name')).toHaveTextContent('Anna Admin');
    await waitFor(() =>
      expect(screen.getByTestId('konflikt')).toHaveTextContent('Anna Admin→Bruno Beispiel'),
    );
    expect(sitzung).toEqual(bruno);
  });

  it('Logout meldet den anderen Tabs „abgemeldet“', async () => {
    await starte();
    const ohr = mithoeren();
    try {
      ergebnisLogout = undefined;
      await userEvent.click(screen.getByText('logout'));
      await waitFor(() => expect(ergebnisLogout).toBe(true));
      expect(screen.getByTestId('name')).toHaveTextContent('anonym');
      await waitFor(() => expect(ohr.gehoert).toEqual([{ art: 'abgemeldet' }]));
      expect(await kopfBeimSchreiben()).toBeNull();
    } finally {
      ohr.schliessen();
    }
  });

  it('Login meldet den anderen Tabs „angemeldet“', async () => {
    sitzung = null;
    await starte('anonym');
    const ohr = mithoeren();
    try {
      await userEvent.click(screen.getByText('login'));
      await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent('Anna Admin'));
      await waitFor(() => expect(ohr.gehoert).toEqual([{ art: 'angemeldet' }]));
    } finally {
      ohr.schliessen();
    }
  });

  it('lokales Abmelden nach einem Ablauf meldet den anderen Tabs „abgemeldet“', async () => {
    await starte();
    const ohr = mithoeren();
    try {
      sitzung = null;
      pruefenAnstossen();
      await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent('anonym'));
      await waitFor(() => expect(ohr.gehoert).toEqual([{ art: 'abgemeldet' }]));
    } finally {
      ohr.schliessen();
    }
  });
});
