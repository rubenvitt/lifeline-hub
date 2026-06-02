import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import { afterAll, afterEach, beforeAll, beforeEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { server } from './server';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);

// Signalisiert React, dass wir in einer act-fähigen Umgebung testen — entfernt die
// „not configured to support act(...)"-Warnung und deckt echte act-Verletzungen auf.
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

// jsdom unter Node 26 liefert kein window.localStorage — minimaler In-Memory-Polyfill,
// damit Komponenten/Hilfen mit Persistenz (z. B. zuletzt gewählte Karte/UHS) testbar sind.
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map<string, string>();
  const localStoragePolyfill: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (schluessel: string) => (store.has(schluessel) ? store.get(schluessel)! : null),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    removeItem: (schluessel: string) => {
      store.delete(schluessel);
    },
    setItem: (schluessel: string, wert: string) => {
      store.set(schluessel, String(wert));
    },
  };
  Object.defineProperty(globalThis, 'localStorage', {
    value: localStoragePolyfill,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(window, 'localStorage', {
    value: localStoragePolyfill,
    writable: true,
    configurable: true,
  });
}

// antd verwendet window.matchMedia (responsive observer) — in jsdom nicht vorhanden.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  cleanup();
  server.resetHandlers();
  localStorage.clear();
});
afterAll(() => server.close());

// jsdom kennt keine EventSource — No-op-Stub verhindert ReferenceError in EtbPage-Tests.
// beforeEach stellt den Stub nach vi.unstubAllGlobals() (z. B. in useEtbStream-Tests) wieder her.
beforeEach(() => {
  if (typeof globalThis.EventSource === 'undefined') {
    vi.stubGlobal('EventSource', class { addEventListener() {} removeEventListener() {} close() {} });
  }
});
