import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  sicherEntfernen,
  sicherLesen,
  sicherSchluessel,
  sicherSchreiben,
} from './sichererSpeicher';

/** Ein Speicher, der bei jedem Zugriff wirft — wie bei einer Einbettung mit SecurityError. */
function werfenderSpeicher(): Storage {
  const wirf = () => {
    throw new DOMException('gesperrt', 'SecurityError');
  };
  return {
    get length(): number {
      return wirf();
    },
    key: wirf,
    getItem: wirf,
    setItem: wirf,
    removeItem: wirf,
    clear: wirf,
  };
}

describe('sichererSpeicher (LFH-942)', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('liest, schreibt, entfernt und listet im Normalfall', () => {
    expect(sicherLesen('a')).toBeNull();
    expect(sicherSchreiben('a', '1')).toBe(true);
    expect(sicherSchreiben('b', '2')).toBe(true);
    expect(sicherLesen('a')).toBe('1');
    expect(sicherSchluessel().sort()).toEqual(['a', 'b']);
    expect(sicherEntfernen('a')).toBe(true);
    expect(sicherLesen('a')).toBeNull();
    expect(sicherSchluessel()).toEqual(['b']);
  });

  it('fällt zurück, wenn localStorage null ist (Firefox mit dom.storage.enabled=false)', () => {
    vi.stubGlobal('localStorage', null);
    expect(sicherLesen('a')).toBeNull();
    expect(sicherSchreiben('a', '1')).toBe(false);
    expect(sicherEntfernen('a')).toBe(false);
    expect(sicherSchluessel()).toEqual([]);
  });

  it('fällt zurück, wenn schon der Zugriff auf localStorage wirft', () => {
    const vorher = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('gesperrt', 'SecurityError');
      },
    });
    try {
      expect(sicherLesen('a')).toBeNull();
      expect(sicherSchreiben('a', '1')).toBe(false);
      expect(sicherEntfernen('a')).toBe(false);
      expect(sicherSchluessel()).toEqual([]);
    } finally {
      if (vorher) Object.defineProperty(globalThis, 'localStorage', vorher);
    }
  });

  it('fällt zurück, wenn jede Methode des Speichers wirft', () => {
    vi.stubGlobal('localStorage', werfenderSpeicher());
    expect(sicherLesen('a')).toBeNull();
    expect(sicherSchreiben('a', '1')).toBe(false);
    expect(sicherEntfernen('a')).toBe(false);
    expect(sicherSchluessel()).toEqual([]);
  });

  it('meldet false, wenn das Kontingent voll ist', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('voll', 'QuotaExceededError');
    });
    expect(sicherSchreiben('a', '1')).toBe(false);
  });
});
