import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import { afterAll, afterEach, beforeAll, beforeEach, vi } from 'vitest';
import { cleanup, configure } from '@testing-library/react';
import { server } from './server';
import { installiereMatchMedia, setzeViewportZurueck } from './viewport';
import { installiereCssVariablenFilter } from './antdCssVariablen';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);

// RTL wartet in findBy*/waitFor per Default nur 1 s, Vitest gesteht 10 s zu. Unter Last
// überschreitet ein erster Render die Sekunde, und der Test scheiterte an der Wartezeit statt
// an der Sache. 5 s bleiben unter testTimeout, damit ein echter Fehlschlag weiter die lesbare
// RTL-Meldung mit DOM-Dump liefert.
configure({ asyncUtilTimeout: 5000 });

// Signalisiert React, dass wir in einer act-fähigen Umgebung testen — entfernt die
// „not configured to support act(...)"-Warnung und deckt echte act-Verletzungen auf.
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom unter Node 26 liefert kein window.localStorage — minimaler In-Memory-Polyfill.
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

// antd 6 nutzt rc-resize-observer flächendeckend; jsdom kennt ResizeObserver nicht. No-op
// reicht: Tests prüfen keine gemessenen Größen.
if (typeof globalThis.ResizeObserver === 'undefined') {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}

// antds Breakpoint-Beobachter braucht `matchMedia`. Der Stub in ./viewport ist
// BREITENBEWUSST (min-/max-width gegen eine steuerbare Breite, Default 1024 px).
installiereMatchMedia();

// Streicht antds `--ant-*`-Deklarationen aus den eingehängten Stilen, weil jsdoms
// `getComputedStyle` je Variable zahlt. Details: ./antdCssVariablen
installiereCssVariablenFilter();

// Web-Storage-Polyfill: Node 26 stellt sein experimentelles globales localStorage ohne
// `--localstorage-file` als undefined bereit und überschattet jsdom. Nur setzen, wenn nichts
// Brauchbares da ist.
if (globalThis.localStorage == null) {
  class InMemoryStorage implements Storage {
    private map = new Map<string, string>();
    get length() {
      return this.map.size;
    }
    clear() {
      this.map.clear();
    }
    getItem(key: string) {
      return this.map.has(key) ? this.map.get(key)! : null;
    }
    key(index: number) {
      return Array.from(this.map.keys())[index] ?? null;
    }
    removeItem(key: string) {
      this.map.delete(key);
    }
    setItem(key: string, value: string) {
      this.map.set(key, String(value));
    }
  }
  const storage = new InMemoryStorage();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  if (globalThis.window)
    Object.defineProperty(globalThis.window, 'localStorage', {
      configurable: true,
      value: storage,
    });
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  cleanup();
  server.resetHandlers();
  localStorage.clear(); // Persistenz (z. B. gemerkte Basemap/UHS) nicht zwischen Tests lecken lassen
  setzeViewportZurueck(); // Breite/Zeigerart/Zuhörer zurück auf den Ausgangszustand
});
afterAll(() => server.close());

// Echte Uhr, beim Laden gesichert: eine Datei, die Fake-Timer aktiv zurücklässt, darf den
// Drain unten nicht hängen lassen.
const echterSetTimeout = globalThis.setTimeout;

// Timer-Drain vor dem Abbau der jsdom-Umgebung: antds `useDebounce` (ErrorList jedes
// `Form.Item`) setzt einen 10-ms-`setTimeout` ohne Abräumen beim Unmount. Endet eine Datei in
// diesen 10 ms, feuert er nach dem Teardown, react-dom liest `window.event` → „window is not
// defined" als Unhandled Error, und Vitest exitet 1 bei grünen Tests. Nur Timer am DATEIENDE
// überleben den Teardown, deshalb einmal je Datei. Node löst Timer nach Fälligkeit aus.
afterAll(() => new Promise<void>((fertig) => echterSetTimeout(fertig, 25)));

// jsdom kennt keine EventSource — No-op-Stub für Seiten, die useEinsatzLiveStream mounten.
// beforeEach stellt ihn nach `vi.unstubAllGlobals()` wieder her.
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
