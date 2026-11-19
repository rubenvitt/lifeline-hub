import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Modul = typeof import('./verlaufGedaechtnis');

async function lade(): Promise<Modul> {
  vi.resetModules();
  return import('./verlaufGedaechtnis');
}

describe('verlaufGedaechtnis', () => {
  let m: Modul;

  beforeEach(async () => {
    sessionStorage.clear();
    m = await lade();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('merkt und liest die Herkunft je Key', () => {
    m.merkeHerkunft('a', { pathname: '/x', search: '?q=1' });
    expect(m.leseHerkunft('a')).toEqual({ pathname: '/x', search: '?q=1' });
    expect(m.leseHerkunft('b')).toBeNull();
  });

  it('merkt nichts für den Key default', () => {
    m.merkeHerkunft('default', { pathname: '/x', search: '' });
    expect(m.leseHerkunft('default')).toBeNull();
  });

  it('überträgt die Herkunft bei replace', () => {
    m.merkeHerkunft('a', { pathname: '/x', search: '?q=1' });
    m.uebertrageHerkunft('a', 'b');
    expect(m.leseHerkunft('b')).toEqual({ pathname: '/x', search: '?q=1' });
    m.uebertrageHerkunft('ohne', 'c');
    expect(m.leseHerkunft('c')).toBeNull();
  });

  it('hält höchstens 50 Einträge', () => {
    expect(m.VERLAUF_HOECHSTENS).toBe(50);
    for (let i = 0; i <= 50; i++) m.merkeHerkunft(`k${i}`, { pathname: `/p${i}`, search: '' });
    expect(m.leseHerkunft('k0')).toBeNull();
    expect(m.leseHerkunft('k1')).toEqual({ pathname: '/p1', search: '' });
    expect(m.leseHerkunft('k50')).toEqual({ pathname: '/p50', search: '' });
  });

  it('überlebt ein neues Laden des Moduls', async () => {
    m.merkeHerkunft('a', { pathname: '/x', search: '?q=1' });
    const neu = await lade();
    expect(neu.leseHerkunft('a')).toEqual({ pathname: '/x', search: '?q=1' });
  });

  it('arbeitet ohne Speicher weiter', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('gesperrt');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('gesperrt');
    });
    expect(() => m.merkeHerkunft('a', { pathname: '/x', search: '' })).not.toThrow();
    expect(m.leseHerkunft('a')).toEqual({ pathname: '/x', search: '' });
  });

  it('räumen leert alles', () => {
    m.merkeHerkunft('a', { pathname: '/x', search: '' });
    m.verlaufGedaechtnisRaeumen();
    expect(m.leseHerkunft('a')).toBeNull();
    expect(sessionStorage.getItem(m.VERLAUF_SCHLUESSEL)).toBeNull();
  });
});
