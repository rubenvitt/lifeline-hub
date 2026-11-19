import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  liesRolle,
  merkeRolle,
  ROLL_HOECHSTENS,
  rollGedaechtnisRaeumen,
  traegtZiel,
} from './rollGedaechtnis';

describe('rollGedaechtnis (LLH-1826)', () => {
  beforeEach(() => rollGedaechtnisRaeumen());
  afterEach(() => vi.restoreAllMocks());

  it('merkt und liest je Schlüssel', () => {
    merkeRolle('a', 1400);
    merkeRolle('b', 20);
    expect(liesRolle('a')).toBe(1400);
    expect(liesRolle('b')).toBe(20);
    expect(liesRolle('c')).toBe(undefined);
  });

  it('überlebt ein Neuladen über sessionStorage', () => {
    merkeRolle('a', 1400);
    expect(sessionStorage.getItem('lfh:rolle')).toContain('1400');
  });

  it(`hält höchstens ${ROLL_HOECHSTENS} Einträge`, () => {
    for (let i = 0; i <= ROLL_HOECHSTENS; i++) merkeRolle(`k${i}`, i);
    expect(liesRolle('k0')).toBe(undefined);
    expect(liesRolle('k1')).toBe(1);
    expect(liesRolle(`k${ROLL_HOECHSTENS}`)).toBe(ROLL_HOECHSTENS);
  });

  it('arbeitet ohne sessionStorage', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('gesperrt');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('gesperrt');
    });
    merkeRolle('a', 700);
    expect(liesRolle('a')).toBe(700);
  });

  it('räumt den Speicher', () => {
    merkeRolle('a', 1400);
    rollGedaechtnisRaeumen();
    expect(liesRolle('a')).toBe(undefined);
    expect(sessionStorage.getItem('lfh:rolle')).toBe(null);
  });

  it('traegtZiel erkennt Deeplink-Parameter', () => {
    expect(traegtZiel(new URLSearchParams('meldung=7'))).toBe(true);
    expect(traegtZiel(new URLSearchParams('eintrag=3&typ=anordnung'))).toBe(true);
    expect(traegtZiel(new URLSearchParams('richtung=extern'))).toBe(false);
  });
});
