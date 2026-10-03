import { http, HttpResponse } from 'msw';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { meHandler, server } from '../test/server';
import { neuerQueryClient } from '../test/utils';
import { rohLesen } from '../test/rohIdb';
import { adminFixture } from '../test/fixtures';
import type { Person } from '../api/types';
import { AuthProvider, useAuth } from './AuthContext';
import { BENUTZER_PRUEFEN, sitzungsMeldungZuruecksetzen } from './sitzungsEvent';
import { ortCacheRaeumen, ortKeyVon, setzeOrt } from '../anzeige/ortCache';
import {
  liesErfassungsSitzungswert,
  schreibeErfassungsSitzungswert,
} from '../components/erfassungsSitzung';
import { entwuerfeLeerenFuerTests, entwurfSpeichern } from '../etb/entwuerfe/entwurfStore';
import type { EtbEntwurf } from '../etb/entwuerfe/entwurfModell';
import {
  queueEinreihen,
  queueLeerenFuerTests,
  schreibaktionEinreihen,
  schreibaktionenLaden,
  schreibaktionPersonAbschliessen,
} from '../offline/queue';

/**
 * Akzeptanz LFH-767 (Spec `geraetedaten-raeumung`): Nach dem Abmelden liegen keine
 * personenbezogenen Daten des vorherigen Benutzers mehr auf dem Gerät, außer der Offline-Queue.
 * Geprüft wird die IndexedDB selbst über eine eigene Verbindung (`rohLesen`), nicht ein Cache.
 */

const a = adminFixture();
const b = { ...a, id: a.id + 1, benutzername: 'zweite', anzeigename: 'Zweite' };

function Anzeige() {
  const { benutzer, laedt, login, logout } = useAuth();
  if (laedt) return <div>lädt…</div>;
  return (
    <div>
      <span data-testid="name">{benutzer ? benutzer.anzeigename : 'anonym'}</span>
      <button onClick={() => login('zweite', 'pw')}>login</button>
      <button onClick={() => logout()}>logout</button>
    </div>
  );
}

function rendern() {
  const client = neuerQueryClient();
  return render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <Anzeige />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

function entwurf(benutzerId: number, id: string): EtbEntwurf {
  const jetzt = new Date().toISOString();
  return {
    id,
    benutzer_id: benutzerId,
    einsatz_id: 7,
    inhalt: `Entwurf ${id}`,
    typ: 'meldung',
    erstellt_at: jetzt,
    geaendert_at: jetzt,
  };
}

/** Was Person A auf dem Gerät hinterlässt, dazu ein vorgemerkter Queue-Eintrag. */
async function geraetVonABefuellen(): Promise<void> {
  await entwurfSpeichern(entwurf(a.id, 'e-a'));
  await schreibaktionEinreihen(a.id, 7, {
    art: 'person',
    daten: { name: 'Muster', status: 'erfasst', client_id: 'q-a' },
  });
  const [zeile] = await schreibaktionenLaden(a.id, 7);
  await schreibaktionPersonAbschliessen(a.id, zeile, { id: 1, name: 'Muster' } as Person);
  await setzeOrt(ortKeyVon(51.16, 10.45), 'Hauptstr. 5, Musterstadt');
  schreibeErfassungsSitzungswert(7, 'person', 'antreff_ort', 'Sammelstelle Süd');
  await queueEinreihen(a.id, 7, { typ: 'meldung', inhalt: 'offline', client_id: 'etb-a' });
}

beforeEach(async () => {
  await entwuerfeLeerenFuerTests();
  await queueLeerenFuerTests();
  await ortCacheRaeumen();
  sessionStorage.clear();
});

afterEach(() => {
  sitzungsMeldungZuruecksetzen();
  vi.restoreAllMocks();
});

describe('Gerät räumen beim Ausgang (LFH-767)', () => {
  it('Abmelden: nichts Personenbezogenes bleibt auf der Platte, außer der Offline-Queue', async () => {
    server.use(
      meHandler(a),
      http.post('/api/auth/logout', () => new HttpResponse(null, { status: 204 })),
    );
    rendern();
    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent(a.anzeigename));
    await geraetVonABefuellen();

    await userEvent.click(screen.getByText('logout'));
    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent('anonym'));

    await waitFor(async () =>
      expect(await rohLesen('lifeline-etb-entwuerfe', 'entwuerfe')).toEqual([]),
    );
    expect(await rohLesen('lifeline-offline', 'personErfassungsQuittungen')).toEqual([]);
    expect(await rohLesen('lifeline-ortcache', 'ortsnamen')).toEqual([]);
    expect(await rohLesen('lifeline-lagebild', 'stand')).toEqual([]);
    expect(liesErfassungsSitzungswert(7, 'person', 'antreff_ort')).toBeUndefined();
    expect(await rohLesen('lifeline-offline', 'ausstehend')).toHaveLength(1);
  });

  it('Abmelden räumt auch, wenn der Server-Logout am Netz scheitert', async () => {
    server.use(
      meHandler(a),
      http.post('/api/auth/logout', () => HttpResponse.error()),
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});
    rendern();
    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent(a.anzeigename));
    await geraetVonABefuellen();

    await userEvent.click(screen.getByText('logout'));

    await waitFor(async () =>
      expect(await rohLesen('lifeline-etb-entwuerfe', 'entwuerfe')).toEqual([]),
    );
    expect(await rohLesen('lifeline-offline', 'personErfassungsQuittungen')).toEqual([]);
  });

  it('Sitzungsende (401): der Entwurf bleibt, der Rest geht', async () => {
    server.use(meHandler(a));
    rendern();
    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent(a.anzeigename));
    await geraetVonABefuellen();

    server.use(http.get('/api/auth/me', () => HttpResponse.json({ error: 'x' }, { status: 401 })));
    act(() => {
      window.dispatchEvent(new Event(BENUTZER_PRUEFEN));
    });
    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent('anonym'));

    await waitFor(async () =>
      expect(await rohLesen('lifeline-offline', 'personErfassungsQuittungen')).toEqual([]),
    );
    expect(await rohLesen('lifeline-ortcache', 'ortsnamen')).toEqual([]);
    expect(liesErfassungsSitzungswert(7, 'person', 'antreff_ort')).toBeUndefined();
    expect(await rohLesen('lifeline-etb-entwuerfe', 'entwuerfe')).toHaveLength(1);
  });

  it('Sitzungsende, erst beim Start bemerkt (401): der Entwurf bleibt, der Rest geht', async () => {
    await geraetVonABefuellen();
    server.use(http.get('/api/auth/me', () => HttpResponse.json({ error: 'x' }, { status: 401 })));
    rendern();
    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent('anonym'));

    await waitFor(async () =>
      expect(await rohLesen('lifeline-offline', 'personErfassungsQuittungen')).toEqual([]),
    );
    expect(await rohLesen('lifeline-ortcache', 'ortsnamen')).toEqual([]);
    expect(await rohLesen('lifeline-etb-entwuerfe', 'entwuerfe')).toHaveLength(1);
    expect(await rohLesen('lifeline-offline', 'ausstehend')).toHaveLength(1);
  });

  it('Netzfehler beim Start ist kein Sitzungsende: nichts wird geräumt', async () => {
    await geraetVonABefuellen();
    server.use(http.get('/api/auth/me', () => HttpResponse.error()));
    rendern();
    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent('anonym'));

    expect(await rohLesen('lifeline-offline', 'personErfassungsQuittungen')).toHaveLength(1);
    expect(await rohLesen('lifeline-ortcache', 'ortsnamen')).toHaveLength(1);
  });

  it('Abmelden in einem anderen Tab räumt hier wie ein Abmelden, nicht wie ein Ablauf', async () => {
    server.use(meHandler(a));
    rendern();
    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent(a.anzeigename));
    await geraetVonABefuellen();

    server.use(http.get('/api/auth/me', () => HttpResponse.json({ error: 'x' }, { status: 401 })));
    const andererTab = new BroadcastChannel('lfh-auth');
    try {
      andererTab.postMessage({ art: 'abgemeldet', anlass: 'abmelden' });
      await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent('anonym'));
      await waitFor(async () =>
        expect(await rohLesen('lifeline-etb-entwuerfe', 'entwuerfe')).toEqual([]),
      );
    } finally {
      andererTab.close();
    }
  });

  it('ein Ablauf in einem anderen Tab lässt den Entwurf hier stehen', async () => {
    server.use(meHandler(a));
    rendern();
    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent(a.anzeigename));
    await geraetVonABefuellen();

    server.use(http.get('/api/auth/me', () => HttpResponse.json({ error: 'x' }, { status: 401 })));
    const andererTab = new BroadcastChannel('lfh-auth');
    try {
      andererTab.postMessage({ art: 'abgemeldet', anlass: 'sitzungsende' });
      await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent('anonym'));
      await waitFor(async () =>
        expect(await rohLesen('lifeline-ortcache', 'ortsnamen')).toEqual([]),
      );
      expect(await rohLesen('lifeline-etb-entwuerfe', 'entwuerfe')).toHaveLength(1);
    } finally {
      andererTab.close();
    }
  });

  it('ein Fehler beim Räumen hält die Abmeldung nicht auf', async () => {
    server.use(
      meHandler(a),
      http.post('/api/auth/logout', () => new HttpResponse(null, { status: 204 })),
    );
    const fehler = vi.spyOn(console, 'error').mockImplementation(() => {});
    rendern();
    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent(a.anzeigename));
    await geraetVonABefuellen();
    const leeren = IDBObjectStore.prototype.clear;
    vi.spyOn(IDBObjectStore.prototype, 'clear').mockImplementation(function (this: IDBObjectStore) {
      if (this.name === 'entwuerfe') throw new Error('Kontingent');
      return leeren.call(this);
    });

    await userEvent.click(screen.getByText('logout'));

    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent('anonym'));
    await waitFor(async () =>
      expect(await rohLesen('lifeline-offline', 'personErfassungsQuittungen')).toEqual([]),
    );
    expect(fehler).toHaveBeenCalled();
  });

  it('Neuladen als B (Benutzerkonflikt, LFH-785): kein Erfassungswert von A ist vorbelegt', async () => {
    server.use(meHandler(a));
    const { unmount } = rendern();
    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent(a.anzeigename));
    schreibeErfassungsSitzungswert(7, 'person', 'antreff_ort', 'Sammelstelle Süd');
    unmount();

    // Ein anderer Tab hat B angemeldet; dieser Tab lädt neu, der sessionStorage überlebt das.
    server.use(meHandler(b));
    rendern();
    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent(b.anzeigename));

    expect(liesErfassungsSitzungswert(7, 'person', 'antreff_ort')).toBeUndefined();
  });

  it('Neuladen als derselbe Benutzer (LFH-785): der behaltene Erfassungswert bleibt', async () => {
    server.use(meHandler(a));
    const { unmount } = rendern();
    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent(a.anzeigename));
    schreibeErfassungsSitzungswert(7, 'person', 'antreff_ort', 'Sammelstelle Süd');
    unmount();

    rendern();
    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent(a.anzeigename));

    expect(liesErfassungsSitzungswert(7, 'person', 'antreff_ort')).toBe('Sammelstelle Süd');
  });

  it('Anmeldung von B nach Ablauf von A: Entwürfe und Quittungen von A sind von der Platte', async () => {
    await geraetVonABefuellen();
    await entwurfSpeichern(entwurf(b.id, 'e-b'));
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json({ error: 'x' }, { status: 401 })),
      http.post('/api/auth/login', () => HttpResponse.json(b)),
    );
    rendern();
    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent('anonym'));
    // Ohne angemeldete Person bleibt der junge Entwurf von A liegen (design.md D4).
    expect(await rohLesen('lifeline-etb-entwuerfe', 'entwuerfe')).toHaveLength(2);

    await userEvent.click(screen.getByText('login'));
    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent('Zweite'));

    await waitFor(async () => {
      const rest = (await rohLesen('lifeline-etb-entwuerfe', 'entwuerfe')) as EtbEntwurf[];
      expect(rest.map((e) => e.id)).toEqual(['e-b']);
    });
    expect(await rohLesen('lifeline-offline', 'personErfassungsQuittungen')).toEqual([]);
    expect(await rohLesen('lifeline-offline', 'ausstehend')).toHaveLength(1);
  });

  it('Start mit bestätigter Person B räumt die Entwürfe von A', async () => {
    await entwurfSpeichern(entwurf(a.id, 'e-a'));
    server.use(meHandler(b));
    rendern();
    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent('Zweite'));

    await waitFor(async () =>
      expect(await rohLesen('lifeline-etb-entwuerfe', 'entwuerfe')).toEqual([]),
    );
  });
});
