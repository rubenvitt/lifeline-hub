import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { merkeRouten } from '../rueckmeldung/adresse';
import { ERWARTETER_BENUTZER_HEADER, setzeErwartetenBenutzer } from './client';
import {
  CLIENT_FEHLER_MELDUNG_MAX,
  CLIENT_FEHLER_PFAD,
  CLIENT_FEHLER_STACK_MAX,
  meldeClientFehler,
} from './clientFehler';

/** Die Routen wie in `App.tsx`, verschachtelt: Muster entstehen erst über die Kette. */
const ROUTEN = [
  {
    path: '/',
    children: [
      {
        path: 'einsaetze/:id',
        children: [{ path: 'personen/:personId' }, { path: 'etb' }],
      },
    ],
  },
];

interface Bericht {
  route: string;
  version: string;
  meldung: string;
  stack: string;
}

let fetchMock: ReturnType<typeof vi.fn>;

function berichte(): Bericht[] {
  return fetchMock.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string));
}

beforeEach(() => {
  fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
  vi.stubGlobal('fetch', fetchMock);
  merkeRouten(ROUTEN);
});

afterEach(() => {
  vi.unstubAllGlobals();
  setzeErwartetenBenutzer(null);
  merkeRouten([]);
});

describe('meldeClientFehler', () => {
  it('meldet jedes Fehlerobjekt genau einmal, auch bei doppeltem Aufruf', async () => {
    const fehler = new Error('kaputt');
    await meldeClientFehler(fehler, '/einsaetze/7/etb');
    await meldeClientFehler(fehler, '/einsaetze/7/etb');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await meldeClientFehler(new Error('kaputt'), '/einsaetze/7/etb');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('nennt das Routenmuster, nicht die Kennungen aus dem Pfad', async () => {
    await meldeClientFehler(new Error('kaputt'), '/einsaetze/7/personen/42?tab=x#oben');

    const [bericht] = berichte();
    expect(bericht.route).toBe('/einsaetze/:id/personen/:personId');
    const roh = (fetchMock.mock.calls[0][1] as RequestInit).body as string;
    expect(roh).not.toContain('/einsaetze/7');
    expect(roh).not.toContain('personen/42');
    expect(roh).not.toContain('tab=x');
  });

  it('schickt ohne passende Route ein leeres Muster statt des Pfads', async () => {
    merkeRouten([]);
    await meldeClientFehler(new Error('kaputt'), '/einsaetze/7/personen/42');

    expect(berichte()[0].route).toBe('');
  });

  it('trägt Version, Meldung und Stack, gekürzt auf 500 und 2000 Zeichen', async () => {
    const fehler = new Error('m'.repeat(CLIENT_FEHLER_MELDUNG_MAX + 100));
    fehler.stack = 's'.repeat(CLIENT_FEHLER_STACK_MAX + 100);
    await meldeClientFehler(fehler, '/einsaetze/7/etb');

    const [bericht] = berichte();
    expect(CLIENT_FEHLER_MELDUNG_MAX).toBe(500);
    expect(CLIENT_FEHLER_STACK_MAX).toBe(2000);
    expect(bericht.version).toBe(__APP_VERSION__);
    expect(bericht.meldung).toBe('m'.repeat(500));
    expect(bericht.stack).toBe('s'.repeat(2000));
  });

  it('kürzt nach Zeichen und zerteilt kein Zeichen außerhalb der Grundebene', async () => {
    const fehler = new Error('🚑'.repeat(CLIENT_FEHLER_MELDUNG_MAX + 1));
    await meldeClientFehler(fehler, '/einsaetze/7/etb');

    expect(berichte()[0].meldung).toBe('🚑'.repeat(500));
  });

  it('sendet per POST mit keepalive, Sitzungscookie und den Schreibköpfen', async () => {
    setzeErwartetenBenutzer(5);
    await meldeClientFehler(new Error('kaputt'), '/einsaetze/7/etb');

    const [pfad, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(pfad).toBe(CLIENT_FEHLER_PFAD);
    expect(init.method).toBe('POST');
    expect(init.keepalive).toBe(true);
    expect(init.credentials).toBe('same-origin');
    expect(init.headers).toMatchObject({
      'Content-Type': 'application/json',
      [ERWARTETER_BENUTZER_HEADER]: '5',
    });
  });

  it('meldet auch einen Wurf ohne Error-Objekt, ohne dessen Inhalt zu senden', async () => {
    await meldeClientFehler({ name: 'Erika Mustermann' }, '/einsaetze/7/etb');

    const [bericht] = berichte();
    expect(bericht.meldung).toBe('Wurf ohne Error-Objekt (object)');
    expect(JSON.stringify(bericht)).not.toContain('Mustermann');
  });

  it('wirft nicht, wenn das Netz fehlt oder der Server ablehnt', async () => {
    fetchMock.mockImplementation(() => Promise.reject(new TypeError('Failed to fetch')));
    await expect(meldeClientFehler(new Error('offline'), '/einsaetze/7/etb')).resolves.toBe(
      undefined,
    );

    fetchMock.mockImplementation(() => Promise.resolve(new Response(null, { status: 401 })));
    await expect(meldeClientFehler(new Error('abgemeldet'), '/einsaetze/7/etb')).resolves.toBe(
      undefined,
    );

    fetchMock.mockImplementation(() => {
      throw new TypeError('fetch fehlt');
    });
    await expect(meldeClientFehler(new Error('synchron'), '/einsaetze/7/etb')).resolves.toBe(
      undefined,
    );
  });
});
