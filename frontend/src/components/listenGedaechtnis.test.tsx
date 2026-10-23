import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, useLocation } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  bereinigeListenZustand,
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

  it('ein kaputter Spaltenspeicher gilt als leer', () => {
    localStorage.setItem('lfh:spalten:schaeden', '{kaputt');
    expect(aufbauen('/s').hook.result.current.spaltenStart).toEqual({ aus: [], an: [] });
  });

  it('jeder Ausgang räumt die gemerkten Listenstände, fremde Sitzungswerte bleiben', () => {
    sessionStorage.setItem('lfh:liste:schaeden:7', 'q=Name');
    sessionStorage.setItem('lfh:erfassung:7:person:ort', 'x');
    listenGedaechtnisRaeumen();
    expect(sessionStorage.getItem('lfh:liste:schaeden:7')).toBeNull();
    expect(sessionStorage.getItem('lfh:erfassung:7:person:ort')).toBe('x');
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
