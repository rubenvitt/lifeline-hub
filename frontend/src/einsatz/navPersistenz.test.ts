import { describe, expect, it } from 'vitest';
import { leseNavWahl, panelZu, schreibeNavWahl } from './navPersistenz';

/**
 * Der Schlüssel wird gegen ein HANDGESCHRIEBENES Literal geprüft, sonst prüfte der Test die
 * Konstante gegen sich selbst und ein umbenannter Schlüssel verlöre still den gemerkten Zustand.
 */
const SCHLUESSEL = 'lfh:nav:eingeklappt';

/**
 * Führt `fn` mit einem Speicher aus, der bei JEDEM Zugriff wirft (Privatmodus). Per
 * `defineProperty`, nicht `vi.spyOn`: `localStorage` ist je nach Node-/jsdom-Stand ein echtes
 * `Storage` oder der Ersatz aus `test/setup.ts`, und ein Spy auf `Storage.prototype` träfe den
 * Ersatz nicht.
 */
function mitWerfendemSpeicher(fn: () => void): void {
  const vorher = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const werfend = {
    get length(): number {
      throw new Error('SecurityError');
    },
    clear: () => {},
    getItem: () => {
      throw new Error('SecurityError');
    },
    key: () => null,
    removeItem: () => {
      throw new Error('SecurityError');
    },
    setItem: () => {
      throw new Error('SecurityError');
    },
  };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: werfend });
  try {
    fn();
  } finally {
    if (vorher) Object.defineProperty(globalThis, 'localStorage', vorher);
  }
}

describe('navPersistenz', () => {
  it('liefert ohne Eintrag „keine Wahl“ (die Vorgabe der Breite gilt, LFH-952)', () => {
    expect(leseNavWahl()).toBeNull();
  });

  it('merkt „zu“ und „offen“ als zwei Werte unter dem festgelegten Schlüssel', () => {
    schreibeNavWahl('zu');
    expect(localStorage.getItem(SCHLUESSEL)).toBe('1');
    expect(leseNavWahl()).toBe('zu');
    schreibeNavWahl('offen');
    expect(localStorage.getItem(SCHLUESSEL)).toBe('0');
    expect(leseNavWahl()).toBe('offen');
  });

  it('liest einen unbekannten Wert als „keine Wahl“', () => {
    localStorage.setItem(SCHLUESSEL, 'ja');
    expect(leseNavWahl()).toBeNull();
  });

  it('ist global, nicht je Einsatz — der Rahmen ist einsatzunabhängig', () => {
    // Kein Einsatz-Argument in der Signatur: ein je Einsatz gemerkter Rahmen
    // wäre für den Benutzer Zufall (mal auf, mal zu, je nach Einsatz).
    expect(schreibeNavWahl).toHaveLength(1);
    expect(leseNavWahl).toHaveLength(0);
  });

  it('wirft nicht, wenn der Speicher gesperrt ist (Privatmodus)', () => {
    mitWerfendemSpeicher(() => {
      expect(() => schreibeNavWahl('zu')).not.toThrow();
      expect(leseNavWahl()).toBeNull();
    });
  });
});

describe('panelZu — Vorgabe je Breite (LFH-952, D5)', () => {
  it('ohne Wahl: zwischen lg und xl zu, ab xl offen', () => {
    expect(panelZu(null, false)).toBe(true);
    expect(panelZu(null, true)).toBe(false);
  });

  it('eine Wahl gilt auf jeder Breite', () => {
    expect(panelZu('zu', true)).toBe(true);
    expect(panelZu('offen', false)).toBe(false);
  });
});
