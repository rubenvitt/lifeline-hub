import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import type { EinsatzFahrzeug, Einheit, ExterneStelle, Fahrzeug } from '../api/types';
import { AuthProvider } from '../auth/AuthContext';
import { adminFixture, benutzerFixture } from '../test/fixtures';
import { meHandler, server } from '../test/server';
import { neuerQueryClient } from '../test/utils';
import { STAMMDATEN_RECHTE_TEXT } from './rechteText';
import {
  externeStellenAlsVorschlaege,
  fahrzeugeAlsVorschlaege,
  funkrufnamenAusEinsatz,
  ladeZuletzt,
  merkeZuletzt,
  useExterneStellenQuelle,
  useZuletztQuelle,
  ZULETZT_MAX,
  zuletztRaeumen,
} from './vorschlagsquellen';

const fz = (f: Partial<EinsatzFahrzeug>) => f as EinsatzFahrzeug;
const stamm = (f: Partial<Fahrzeug>) => f as Fahrzeug;
const stelle = (s: Partial<ExterneStelle>) =>
  ({ aktiv: true, zustaendig: false, art: 'sonstige', ...s }) as ExterneStelle;

describe('funkrufnamenAusEinsatz', () => {
  it('Fahrzeuge mit OPTA in Klammern und Einheiten, ohne Doppel, alphabetisch; Demo markiert', () => {
    expect(
      funkrufnamenAusEinsatz(
        [
          fz({ id: 1, funkrufname: 'Zebra', opta: 'Z 1', ist_demo: false }),
          fz({ id: 2, funkrufname: 'Demo-RTW', opta: null, ist_demo: true }),
        ],
        [{ id: 9, name: 'Anton' } as Einheit, { id: 8, name: 'Anton' } as Einheit],
      ),
    ).toEqual([
      { label: 'Anton', wert: 'Anton' },
      { label: 'Demo-RTW', wert: 'Demo-RTW', demo: true },
      { label: 'Zebra (Z 1)', wert: 'Zebra (Z 1)' },
    ]);
  });
});

describe('fahrzeugeAlsVorschlaege', () => {
  it('nimmt den Funkrufnamen wie im Einsatz (mit OPTA), trägt die Referenz und die Demo-Marke', () => {
    expect(
      fahrzeugeAlsVorschlaege([
        stamm({ id: 3, funkrufname: 'ELW 1', opta: '11/10', ist_demo: false }),
        stamm({ id: 4, funkrufname: 'Demo-ELW', opta: null, ist_demo: true }),
      ]),
    ).toEqual([
      {
        label: 'ELW 1 (11/10)',
        wert: 'ELW 1 (11/10)',
        ref: { quelle: 'fahrzeugeStammdaten', id: 3 },
      },
      {
        label: 'Demo-ELW',
        wert: 'Demo-ELW',
        ref: { quelle: 'fahrzeugeStammdaten', id: 4 },
        demo: true,
      },
    ]);
  });
});

describe('externeStellenAlsVorschlaege', () => {
  it('Bezeichnung und, wenn gepflegt, Funkrufname; inaktive Stellen fallen weg', () => {
    expect(
      externeStellenAlsVorschlaege([
        stelle({ id: 1, bezeichnung: 'ILS Musterkreis', funkrufname: 'Leitstelle Musterkreis' }),
        stelle({ id: 2, bezeichnung: 'Polizei', aktiv: false }),
      ]),
    ).toEqual([
      {
        label: 'ILS Musterkreis',
        wert: 'ILS Musterkreis',
        ref: { quelle: 'externeStellen', id: 1 },
      },
      {
        label: 'Leitstelle Musterkreis · ILS Musterkreis',
        wert: 'Leitstelle Musterkreis',
        ref: { quelle: 'externeStellen', id: 1 },
      },
    ]);
  });
});

describe('Zuletzt verwendet (am Gerät)', () => {
  it('merkt neueste vorn, ohne Doppel und Leeres, höchstens ZULETZT_MAX', () => {
    merkeZuletzt('funkrufname', 'ELW 1', '  ');
    merkeZuletzt('funkrufname', 'Polizei', 'elw 1 ');
    expect(ladeZuletzt('funkrufname')).toEqual(['elw 1', 'Polizei']);
    for (let i = 0; i < ZULETZT_MAX + 3; i++) merkeZuletzt('funkrufname', `Stelle ${i}`);
    expect(ladeZuletzt('funkrufname')).toHaveLength(ZULETZT_MAX);
    expect(ladeZuletzt('funkrufname')[0]).toBe(`Stelle ${ZULETZT_MAX + 2}`);
  });

  it('übersteht einen fremden Wert im Speicher und das Räumen beim Abmelden', () => {
    localStorage.setItem('lfh:stammdatenfeld:zuletzt:funkrufname', '{kaputt');
    expect(ladeZuletzt('funkrufname')).toEqual([]);
    merkeZuletzt('funkrufname', 'ELW 1');
    merkeZuletzt('anderes', 'X');
    zuletztRaeumen();
    expect(ladeZuletzt('funkrufname')).toEqual([]);
    expect(ladeZuletzt('anderes')).toEqual([]);
  });

  it('die Quelle folgt dem Merken ohne Neuladen', () => {
    const { result } = renderHook(() => useZuletztQuelle('funkrufname'));
    expect(result.current.eintraege).toEqual([]);
    act(() => merkeZuletzt('funkrufname', 'ELW 1'));
    expect(result.current).toMatchObject({
      id: 'zuletztVerwendet',
      gruppe: 'zuletzt',
      eintraege: [{ label: 'ELW 1', wert: 'ELW 1' }],
    });
  });
});

describe('useExterneStellenQuelle', () => {
  function wrapper(client = neuerQueryClient()) {
    return ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>
        <AuthProvider>{children}</AuthProvider>
      </QueryClientProvider>
    );
  }

  it('bietet die Übernahme mit Stammdaten-Recht an und legt als „Sonstige“ an', async () => {
    let angelegt: unknown;
    server.use(
      meHandler(adminFixture()),
      http.get('/api/externe-stellen', () => HttpResponse.json([])),
      http.post('/api/externe-stellen', async ({ request }) => {
        angelegt = await request.json();
        return HttpResponse.json(stelle({ id: 77, bezeichnung: 'Polizei' }), { status: 201 });
      }),
    );
    const { result } = renderHook(() => useExterneStellenQuelle({ uebernahme: true }), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.uebernahme?.gesperrt).toBeNull());
    expect(result.current.uebernahme?.ziel).toBe('Externe Stellen');
    await expect(result.current.uebernahme!.anlegen('Polizei')).resolves.toMatchObject({ id: 77 });
    expect(angelegt).toEqual({ bezeichnung: 'Polizei', art: 'sonstige' });
  });

  it('sperrt die Übernahme ohne Recht mit dem Grund der Stammdaten-Seiten', async () => {
    server.use(
      meHandler(benutzerFixture({ id: 2, org_rolle: 'fuehrungskraft' })),
      http.get('/api/externe-stellen', () => HttpResponse.json([])),
    );
    const { result } = renderHook(() => useExterneStellenQuelle({ uebernahme: true }), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.uebernahme?.gesperrt).toBe(STAMMDATEN_RECHTE_TEXT));
  });

  it('ohne Übernahme (ETB) nur Vorschläge', async () => {
    server.use(
      http.get('/api/externe-stellen', () =>
        HttpResponse.json([stelle({ id: 1, bezeichnung: 'ILS Musterkreis' })]),
      ),
    );
    const { result } = renderHook(() => useExterneStellenQuelle({ uebernahme: false }), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.eintraege).toHaveLength(1));
    expect(result.current.uebernahme).toBeUndefined();
  });
});
