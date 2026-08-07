import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Person } from '../api/types';
import {
  meldeOfflineSchreibaktionGesendet,
  offlineQuittungsKanalZuruecksetzenFuerTests,
} from './ereignisse';

const person = { id: 7, registrier_nr: 7, status: 'vermisst' } as Person;

let storageZuruecksetzen: (() => void) | undefined;

function installiereStorageSpion() {
  const vorher = Object.getOwnPropertyDescriptor(window, 'localStorage');
  const removeItem = vi.fn();
  const setItem = vi.fn();
  const storage: Storage = {
    length: 0,
    clear: vi.fn(),
    getItem: vi.fn(() => null),
    key: vi.fn(() => null),
    removeItem,
    setItem,
  };
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: storage,
  });
  storageZuruecksetzen = () => {
    if (vorher) Object.defineProperty(window, 'localStorage', vorher);
    else Reflect.deleteProperty(window, 'localStorage');
  };
  return { removeItem, setItem };
}

function personGesendet() {
  meldeOfflineSchreibaktionGesendet({
    art: 'person',
    benutzerId: 11,
    einsatzId: 22,
    clientId: 'bleibt-lokal',
    daten: person,
    sicht: 'vermisst',
  });
}

beforeEach(() => offlineQuittungsKanalZuruecksetzenFuerTests());

afterEach(() => {
  offlineQuittungsKanalZuruecksetzenFuerTests();
  storageZuruecksetzen?.();
  storageZuruecksetzen = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('datenarmes Offline-Receipt-Signal', () => {
  it('fällt bei gescheiterter BroadcastChannel-Konstruktion auf Storage zurück', () => {
    class WirftBeimOeffnen {
      constructor() { throw new Error('gesperrt'); }
    }
    vi.stubGlobal('BroadcastChannel', WirftBeimOeffnen);
    const { removeItem, setItem } = installiereStorageSpion();

    expect(personGesendet).not.toThrow();
    expect(removeItem).toHaveBeenCalledWith('lfh:offline-quittung-signal');
    expect(setItem).toHaveBeenCalledOnce();
    const [key, serialisiert] = setItem.mock.calls[0];
    expect(key).toBe('lfh:offline-quittung-signal');
    expect(JSON.parse(serialisiert)).toEqual({
      typ: 'person-erfassungsquittung', benutzerId: 11, einsatzId: 22,
    });
    expect(serialisiert).not.toContain('bleibt-lokal');
  });

  it('fällt auch bei gescheitertem postMessage ohne Flush-Fehler auf Storage zurück', () => {
    const close = vi.fn();
    class WirftBeimSenden {
      postMessage() { throw new Error('inzwischen geschlossen'); }
      addEventListener() {}
      removeEventListener() {}
      close() { close(); }
    }
    vi.stubGlobal('BroadcastChannel', WirftBeimSenden);
    const { setItem } = installiereStorageSpion();

    expect(personGesendet).not.toThrow();
    expect(close).toHaveBeenCalledOnce();
    expect(setItem).toHaveBeenCalledOnce();
    expect(JSON.parse(setItem.mock.calls[0][1])).toEqual({
      typ: 'person-erfassungsquittung', benutzerId: 11, einsatzId: 22,
    });
  });
});
