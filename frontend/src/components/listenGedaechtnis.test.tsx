import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, useLocation } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  bereinigeListenZustand,
  listenGedaechtnisBinden,
  listenGedaechtnisRaeumen,
  useListenGedaechtnis,
  type GedaechtnisSpalte,
} from './listenGedaechtnis';

/**
 * Das Gedächtnis einer Liste (LLH-1086, Spec `tabellen-sortieren-filtern`): Sortierung, Filter und
 * Suche in der Adresse, für den Rückweg ohne Parameter in `sessionStorage`; die Spaltenwahl je
 * Seite am Gerät.
 */
const SPALTEN: readonly GedaechtnisSpalte[] = [
  { key: 'reg', sortWert: () => 1 },
  {
    key: 'ausmass',
    sortWert: () => 1,
    filter: { werte: [{ value: 'gross' }, { value: 'mittel' }, { value: 'gering' }] },
  },
  { key: 'typ', filter: { werte: [{ value: 'sturm' }, { value: 'wasser' }] } },
  // KatalogTabelle-Form: antds Haken statt sortWert/filter.
  { key: 'name', sorter: true, filters: [{ value: 'a' }, { value: 'b' }] },
];
const VORGABE = { spalte: 'reg', richtung: 'ab' } as const;

function aufbauen(start: string) {
  const ort = { aktuell: '' };
  function Ortsfuehler() {
    const l = useLocation();
    ort.aktuell = `${l.pathname}${l.search}`;
    return null;
  }
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[start]}>
      <Ortsfuehler />
      {children}
    </MemoryRouter>
  );
  const hook = renderHook(
    () => useListenGedaechtnis('schaeden', SPALTEN, { vorgabe: VORGABE, einsatzId: 7 }),
    { wrapper },
  );
  return { hook, ort };
}

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

describe('bereinigeListenZustand (LLH-1086)', () => {
  it('verwirft unbekannte Spalten und Werte, eine fremde Sortierung fällt auf die Vorgabe', () => {
    expect(
      bereinigeListenZustand(
        {
          sortierung: { spalte: 'typ', richtung: 'auf' },
          filter: { ausmass: ['gross', 'riesig'], fremd: ['x'], typ: ['quer'], name: ['b'] },
          suche: 'Deich',
        },
        SPALTEN,
        VORGABE,
      ),
    ).toEqual({ sortierung: VORGABE, filter: { ausmass: ['gross'], name: ['b'] }, suche: 'Deich' });
  });

  it('„aus“ bleibt unsortiert, eine sortierbare Spalte gilt in beiden Formen', () => {
    const roh = { filter: {}, suche: '' };
    expect(bereinigeListenZustand({ ...roh, sortierung: null }, SPALTEN, VORGABE).sortierung).toBe(
      null,
    );
    expect(
      bereinigeListenZustand(
        { ...roh, sortierung: { spalte: 'name', richtung: 'auf' } },
        SPALTEN,
        VORGABE,
      ).sortierung,
    ).toEqual({ spalte: 'name', richtung: 'auf' });
  });
});

describe('bereinigeListenZustand · Spalten aus den Daten (LLH-1096)', () => {
  it('lässt Filter und Sortierung einer Spalte stehen, deren Werte erst mit den Daten kommen', () => {
    expect(
      bereinigeListenZustand(
        {
          sortierung: { spalte: 'traeger', richtung: 'ab' },
          filter: { traeger: ['ASB', ''], fremd: ['x'] },
          suche: '',
        },
        SPALTEN,
        VORGABE,
        new Set(['traeger']),
      ),
    ).toEqual({
      sortierung: { spalte: 'traeger', richtung: 'ab' },
      filter: { traeger: ['ASB'] },
      suche: '',
    });
  });

  it('der Hook reicht `ausDaten` durch', () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <MemoryRouter initialEntries={['/s?f.traeger=ASB&sort=traeger:auf']}>{children}</MemoryRouter>
    );
    const hook = renderHook(
      () =>
        useListenGedaechtnis('fahrzeuge', SPALTEN, {
          vorgabe: VORGABE,
          einsatzId: 7,
          ausDaten: ['traeger'],
        }),
      { wrapper },
    );
    expect(hook.result.current.start).toEqual({
      sortierung: { spalte: 'traeger', richtung: 'auf' },
      filter: { traeger: ['ASB'] },
      suche: '',
    });
  });
});

describe('useListenGedaechtnis (LLH-1086)', () => {
  it('liest den Stand aus der Adresse', () => {
    const { hook } = aufbauen('/s?sort=ausmass:auf&f.typ=sturm&q=Deich');
    expect(hook.result.current.start).toEqual({
      sortierung: { spalte: 'ausmass', richtung: 'auf' },
      filter: { typ: ['sturm'] },
      suche: 'Deich',
    });
  });

  it('ohne Listenparameter gilt die Vorgabe', () => {
    const { hook } = aufbauen('/s?neu=1');
    expect(hook.result.current.start).toEqual({ sortierung: VORGABE, filter: {}, suche: '' });
  });

  it('meldet in die Adresse (fremde Parameter bleiben, die Vorgabe fehlt) und in die Sitzung', () => {
    const { hook, ort } = aufbauen('/s?neu=1');
    act(() =>
      hook.result.current.melde({ sortierung: VORGABE, filter: { typ: ['wasser'] }, suche: '' }),
    );
    expect(ort.aktuell).toBe('/s?neu=1&f.typ=wasser');
    act(() => hook.result.current.melde({ sortierung: null, filter: {}, suche: '' }));
    expect(ort.aktuell).toBe('/s?neu=1&sort=aus');
    expect(sessionStorage.getItem('lfh:liste:schaeden:7')).toBe('sort=aus');
  });

  it('der Rückweg ohne Parameter holt den gemerkten Stand und schreibt ihn in die Adresse', () => {
    sessionStorage.setItem('lfh:liste:schaeden:7', 'f.ausmass=gross&q=Ufer');
    const { hook, ort } = aufbauen('/s');
    expect(hook.result.current.start.filter).toEqual({ ausmass: ['gross'] });
    expect(hook.result.current.start.suche).toBe('Ufer');
    expect(ort.aktuell).toBe('/s?f.ausmass=gross&q=Ufer');
  });

  it('die Adresse gewinnt über den gemerkten Stand', () => {
    sessionStorage.setItem('lfh:liste:schaeden:7', 'f.ausmass=gross');
    const { hook } = aufbauen('/s?f.typ=sturm');
    expect(hook.result.current.start.filter).toEqual({ typ: ['sturm'] });
  });

  it('die Spaltenwahl liegt je Seite am Gerät, unabhängig vom Einsatz', () => {
    localStorage.setItem('lfh:spalten:schaeden', JSON.stringify({ aus: ['typ', 'weg'], an: [] }));
    const { hook } = aufbauen('/s');
    expect(hook.result.current.spaltenStart).toEqual({ aus: ['typ'], an: [] });
    act(() => hook.result.current.meldeSpalten({ aus: [], an: ['name'] }));
    expect(JSON.parse(localStorage.getItem('lfh:spalten:schaeden')!)).toEqual({
      aus: [],
      an: ['name'],
    });
  });

  it('ein kaputter Spaltenspeicher gilt als nicht gemerkt', () => {
    localStorage.setItem('lfh:spalten:schaeden', '{kaputt');
    expect(aufbauen('/s').hook.result.current.spaltenStart).toBeNull();
  });

  it('ohne gemerkte Wahl ist die Spaltenwahl offen, damit die Voreinstellung der Seite gilt (LLH-1096)', () => {
    expect(aufbauen('/s').hook.result.current.spaltenStart).toBeNull();
  });

  it('jeder Ausgang räumt die gemerkten Listenstände, fremde Sitzungswerte bleiben', () => {
    sessionStorage.setItem('lfh:liste:schaeden:7', 'q=Name');
    sessionStorage.setItem('lfh:erfassung:7:person:ort', 'x');
    listenGedaechtnisRaeumen();
    expect(sessionStorage.getItem('lfh:liste:schaeden:7')).toBeNull();
    expect(sessionStorage.getItem('lfh:erfassung:7:person:ort')).toBe('x');
  });
});

/**
 * Kontowechsel ohne Abmelden in diesem Tab (LLH-1428, wie LFH-785 bei den Erfassungswerten): der
 * Konfliktdialog lädt die Seite als B neu, der sessionStorage überlebt das. Ein Suchbegriff von A
 * kann einen Namen tragen und stünde sonst in der Liste von B.
 */
describe('listenGedaechtnisBinden (LLH-1428)', () => {
  const A = 11;
  const B = 12;
  const LISTE = 'lfh:liste:schaeden:7';

  it('Wechsel von A zu B: die Listenstände von A sind weg', () => {
    listenGedaechtnisBinden(A);
    sessionStorage.setItem(LISTE, 'f.ausmass=gross&q=Meier');
    sessionStorage.setItem('lfh:liste:stammdaten-personal', 'q=Schulz');

    listenGedaechtnisBinden(B);

    expect(sessionStorage.getItem(LISTE)).toBeNull();
    expect(sessionStorage.getItem('lfh:liste:stammdaten-personal')).toBeNull();
  });

  it('derselbe Benutzer erneut (Neuladen als A): der Stand bleibt', () => {
    listenGedaechtnisBinden(A);
    sessionStorage.setItem(LISTE, 'f.ausmass=gross');

    listenGedaechtnisBinden(A);

    expect(sessionStorage.getItem(LISTE)).toBe('f.ausmass=gross');
  });

  it('verwirft einen Stand aus der Zeit vor der Bindung, statt ihn zu übernehmen', () => {
    sessionStorage.setItem(LISTE, 'q=ohne Besitzer');

    listenGedaechtnisBinden(A);

    expect(sessionStorage.getItem(LISTE)).toBeNull();
  });

  it('ohne Benutzer räumt es nichts — das tun Abmelden und Sitzungsende', () => {
    listenGedaechtnisBinden(A);
    sessionStorage.setItem(LISTE, 'f.ausmass=gross');

    listenGedaechtnisBinden(null);

    expect(sessionStorage.getItem(LISTE)).toBe('f.ausmass=gross');
  });

  it('lässt fremde Sitzungswerte stehen', () => {
    listenGedaechtnisBinden(A);
    sessionStorage.setItem('lfh:erfassung:7:person:ort', 'x');

    listenGedaechtnisBinden(B);

    expect(sessionStorage.getItem('lfh:erfassung:7:person:ort')).toBe('x');
  });

  it('nach dem Räumen beim Abmelden bindet sich der nächste Benutzer neu', () => {
    listenGedaechtnisBinden(A);
    listenGedaechtnisRaeumen();
    listenGedaechtnisBinden(B);
    sessionStorage.setItem(LISTE, 'f.ausmass=gering');

    listenGedaechtnisBinden(B);

    expect(sessionStorage.getItem(LISTE)).toBe('f.ausmass=gering');
  });

  it('die Bindung ist kein Listenstand: eine Seite liest sie nicht als Sicht', () => {
    listenGedaechtnisBinden(A);
    const { hook, ort } = aufbauen('/s');
    expect(hook.result.current.start).toEqual({ sortierung: VORGABE, filter: {}, suche: '' });
    expect(ort.aktuell).toBe('/s');
  });

  it('wirft nicht ohne sessionStorage', () => {
    const vorher = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: undefined });
    try {
      expect(() => listenGedaechtnisBinden(A)).not.toThrow();
    } finally {
      if (vorher) Object.defineProperty(globalThis, 'sessionStorage', vorher);
    }
  });
});

describe('useListenGedaechtnis · neuer Aufbau der Sicht (LLH-1086)', () => {
  it('nach einer Meldung beginnt ein neuer Träger beim gemeldeten Stand', () => {
    const { hook } = aufbauen('/s');
    const neu = { sortierung: null, filter: { typ: ['sturm'] }, suche: 'x' };
    act(() => hook.result.current.melde(neu));
    act(() => hook.result.current.meldeSpalten({ aus: ['typ'], an: [] }));
    expect(hook.result.current.start).toEqual(neu);
    expect(hook.result.current.spaltenStart).toEqual({ aus: ['typ'], an: [] });
  });
});

/**
 * Personenbezogene Suche bleibt aus der Adresse (LLH-1096, Betroffene): ein Name stünde sonst im
 * Verlauf des Browsers, in Lesezeichen und in jedem geteilten Link. Sortierung und Filter tragen
 * keine Personendaten und stehen weiter dort.
 */
describe('useListenGedaechtnis · Suche nur in der Sitzung (LLH-1096)', () => {
  function aufbauenOhneSuche(start: string) {
    const ort = { aktuell: '' };
    function Ortsfuehler() {
      const l = useLocation();
      ort.aktuell = `${l.pathname}${l.search}`;
      return null;
    }
    const wrapper = ({ children }: { children: ReactNode }) => (
      <MemoryRouter initialEntries={[start]}>
        <Ortsfuehler />
        {children}
      </MemoryRouter>
    );
    const hook = renderHook(
      () =>
        useListenGedaechtnis('personen', SPALTEN, {
          vorgabe: VORGABE,
          einsatzId: 7,
          sucheInAdresse: false,
        }),
      { wrapper },
    );
    return { hook, ort };
  }

  it('meldet Filter in die Adresse, die Suche nur in die Sitzung', () => {
    const { hook, ort } = aufbauenOhneSuche('/p');
    act(() =>
      hook.result.current.melde({
        sortierung: VORGABE,
        filter: { typ: ['sturm'] },
        suche: 'Meier',
      }),
    );
    expect(ort.aktuell).toBe('/p?f.typ=sturm');
    expect(sessionStorage.getItem('lfh:liste:personen:7')).toBe('f.typ=sturm&q=Meier');
  });

  it('liest keine Suche aus der Adresse und räumt sie dort weg', () => {
    const { hook, ort } = aufbauenOhneSuche('/p?q=Meier&neu=1');
    expect(hook.result.current.start.suche).toBe('');
    expect(ort.aktuell).toBe('/p?neu=1');
  });

  it('der Rückweg ohne Parameter bringt die Suche aus der Sitzung, die Adresse nur den Filter', () => {
    sessionStorage.setItem('lfh:liste:personen:7', 'f.typ=sturm&q=Meier');
    const { hook, ort } = aufbauenOhneSuche('/p');
    expect(hook.result.current.start).toEqual({
      sortierung: VORGABE,
      filter: { typ: ['sturm'] },
      suche: 'Meier',
    });
    expect(ort.aktuell).toBe('/p?f.typ=sturm');
  });
});
