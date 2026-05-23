import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import { afterAll, afterEach, beforeAll, beforeEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { server } from './server';

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
});
afterAll(() => server.close());

import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
dayjs.extend(utc);

// jsdom kennt keine EventSource — No-op-Stub verhindert ReferenceError in EtbPage-Tests.
// beforeEach stellt den Stub nach vi.unstubAllGlobals() (z. B. in useEtbStream-Tests) wieder her.
beforeEach(() => {
  if (typeof globalThis.EventSource === 'undefined') {
    vi.stubGlobal('EventSource', class { addEventListener() {} removeEventListener() {} close() {} });
  }
});
