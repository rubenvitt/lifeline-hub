import { describe, expect, it } from 'vitest';
import { leseNavEingeklappt, schreibeNavEingeklappt } from './navPersistenz';

/**
 * Der Schlüssel wird gegen ein HANDGESCHRIEBENES Literal geprüft, nicht gegen
 * eine importierte Konstante — sonst prüfte der Test die Konstante gegen sich
 * selbst und bliebe auch bei umbenanntem Schlüssel grün, während der gemerkte
 * Zustand des Benutzers still verlorenginge (dieselbe Falle wie beim
 * Byte-Pin der Wire-Strings in `api/queryKeys`).
 */
const SCHLUESSEL = 'lfh:nav:eingeklappt';

/**
 * Führt `fn` mit einem Speicher aus, der bei JEDEM Zugriff wirft — der
 * Privatmodus-Fall. Bewusst per `defineProperty` und nicht per `vi.spyOn`:
 * `localStorage` ist in dieser Suite je nach Node-/jsdom-Stand mal ein echtes
 * `Storage`, mal der In-Memory-Ersatz aus `test/setup.ts`; ein Spy auf
 * `Storage.prototype` träfe den Ersatz gar nicht und der Test wäre still grün.
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
  it('liefert ohne gemerkten Zustand „nicht eingeklappt"', () => {
    expect(leseNavEingeklappt()).toBe(false);
  });

  it('merkt den eingeklappten Zustand unter dem festgelegten Schlüssel', () => {
    schreibeNavEingeklappt(true);
    expect(localStorage.getItem(SCHLUESSEL)).toBe('1');
    expect(leseNavEingeklappt()).toBe(true);
  });

  it('räumt den Schlüssel wieder ab, statt eine zweite Wahrheit zu hinterlassen', () => {
    schreibeNavEingeklappt(true);
    schreibeNavEingeklappt(false);
    expect(localStorage.getItem(SCHLUESSEL)).toBeNull();
    expect(leseNavEingeklappt()).toBe(false);
  });

  it('ist global, nicht je Einsatz — der Rahmen ist einsatzunabhängig', () => {
    // Kein Einsatz-Argument in der Signatur: ein je Einsatz gemerkter Rahmen
    // wäre für den Benutzer Zufall (mal auf, mal zu, je nach Einsatz).
    expect(schreibeNavEingeklappt).toHaveLength(1);
    expect(leseNavEingeklappt).toHaveLength(0);
  });

  it('wirft nicht, wenn der Speicher gesperrt ist (Privatmodus)', () => {
    mitWerfendemSpeicher(() => {
      expect(() => schreibeNavEingeklappt(true)).not.toThrow();
      expect(leseNavEingeklappt()).toBe(false);
    });
  });
});
