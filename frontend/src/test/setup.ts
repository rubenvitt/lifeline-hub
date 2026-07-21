import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import { afterAll, afterEach, beforeAll, beforeEach, vi } from 'vitest';
import { cleanup, configure } from '@testing-library/react';
import { server } from './server';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);

// RTL wartet in findBy*/waitFor per Default nur 1 s — während vite.config.ts dem Test
// 10 s zugesteht (testTimeout). Diese Schere ist der Grund, aus dem ein bloß langsamer
// Mount als „Unable to find an element" erscheint statt als Timeout: unter Last (volle
// Suite mit Datei-Parallelität, parallele cargo-Builds) überschreitet der erste Render
// einer Seite die Sekunde, und der Test scheitert an der Wartezeit, nicht an der Sache
// (LFH-308). 5 s bleiben bewusst unter testTimeout, damit ein echter Fehlschlag weiter
// die lesbare RTL-Meldung mit DOM-Dump liefert und nicht im Vitest-Timeout verschwindet.
// Der grüne Pfad wird dadurch nicht langsamer — gewartet wird nur, bis das Element da ist.
configure({ asyncUtilTimeout: 5000 });

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

// antd 6 nutzt rc-resize-observer flächendeckend (Table, Space, Tabs …) — jsdom kennt
// ResizeObserver nicht, sonst wirft jeder Render ReferenceError und reißt die Suite ab.
// No-op reicht: Tests prüfen Inhalt/Verhalten, keine gemessenen Größen.
if (typeof globalThis.ResizeObserver === 'undefined') {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
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

// Web-Storage-Polyfill: jsdom liefert hier kein localStorage, und Node 26 stellt sein
// experimentelles globales localStorage ohne `--localstorage-file` als undefined bereit
// (→ überschattet jsdom). Guard: nur setzen, wenn nichts Brauchbares vorhanden ist.
if (globalThis.localStorage == null) {
  class InMemoryStorage implements Storage {
    private map = new Map<string, string>();
    get length() { return this.map.size; }
    clear() { this.map.clear(); }
    getItem(key: string) { return this.map.has(key) ? this.map.get(key)! : null; }
    key(index: number) { return Array.from(this.map.keys())[index] ?? null; }
    removeItem(key: string) { this.map.delete(key); }
    setItem(key: string, value: string) { this.map.set(key, String(value)); }
  }
  const storage = new InMemoryStorage();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  if (globalThis.window) Object.defineProperty(globalThis.window, 'localStorage', { configurable: true, value: storage });
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  cleanup();
  server.resetHandlers();
  localStorage.clear(); // Persistenz (z. B. gemerkte Basemap/UHS) nicht zwischen Tests lecken lassen
});
afterAll(() => server.close());

// jsdom kennt keine EventSource — No-op-Stub verhindert ReferenceError in Seiten-Tests, die
// useEinsatzLiveStream mounten. beforeEach stellt den Stub nach vi.unstubAllGlobals() (z. B. in
// den useEinsatzLiveStream-Tests, die eine FakeEventSource stubben) wieder her.
beforeEach(() => {
  if (typeof globalThis.EventSource === 'undefined') {
    vi.stubGlobal(
      'EventSource',
      class {
        static CONNECTING = 0;
        static OPEN = 1;
        static CLOSED = 2;
        readyState = 1;
        onopen: (() => void) | null = null;
        onerror: (() => void) | null = null;
        addEventListener() {}
        removeEventListener() {}
        close() {}
      },
    );
  }
});
