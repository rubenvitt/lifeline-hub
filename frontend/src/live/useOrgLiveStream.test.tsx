import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { neuerQueryClient } from '../test/utils';
import { useOrgLiveStream } from './useOrgLiveStream';
import { meldeEinsatzStrom } from './einsatzStromStore';

/** Zeichnet Verbindungen auf; `emit` spielt ein Ereignis oder `open` ein. */
class FakeEventSource {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  static instanzen: FakeEventSource[] = [];
  static offene(): string[] {
    return FakeEventSource.instanzen.filter((q) => !q.closed).map((q) => q.url);
  }
  url: string;
  closed = false;
  readyState = FakeEventSource.OPEN;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private listeners: Record<string, ((e: MessageEvent) => void)[]> = {};
  constructor(url: string) {
    this.url = url;
    FakeEventSource.instanzen.push(this);
  }
  addEventListener(typ: string, cb: (e: MessageEvent) => void) {
    (this.listeners[typ] ??= []).push(cb);
  }
  removeEventListener(typ: string, cb: (e: MessageEvent) => void) {
    this.listeners[typ] = (this.listeners[typ] ?? []).filter((l) => l !== cb);
  }
  close() {
    this.closed = true;
  }
  emit(typ: string, data = '{}') {
    if (typ === 'open') {
      this.onopen?.();
      return;
    }
    (this.listeners[typ] ?? []).forEach((cb) => cb(new MessageEvent(typ, { data })));
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  FakeEventSource.instanzen = [];
});

function Probe({ angemeldet }: { angemeldet: boolean }) {
  useOrgLiveStream(angemeldet);
  return null;
}

function mount(angemeldet: boolean, client: QueryClient = neuerQueryClient()) {
  return render(
    <QueryClientProvider client={client}>
      <Probe angemeldet={angemeldet} />
    </QueryClientProvider>,
  );
}

describe('useOrgLiveStream (LFH-734)', () => {
  it('öffnet ohne Anmeldung keine Verbindung', () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    mount(false);
    expect(FakeEventSource.instanzen).toHaveLength(0);
  });

  it('öffnet angemeldet genau eine Verbindung zu /api/live', () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    mount(true);
    expect(FakeEventSource.offene()).toEqual(['/api/live']);
  });

  it('gleicht schon beim ersten open die Org-Keys ab (Lücke beim Wechsel aus dem Einsatz)', () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const client = neuerQueryClient();
    const spy = vi.spyOn(client, 'invalidateQueries');
    mount(true, client);
    FakeEventSource.instanzen[0].emit('open');
    expect(spy).toHaveBeenCalledWith({ queryKey: ['einsaetze'] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['personal'] });
  });

  it('frischt bei einsatzliste und stammdaten die globalen Prefixe auf, bei lagged alle', () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const client = new QueryClient();
    client.setQueryData(['einsaetze'], []);
    client.setQueryData(['material', 'alle'], []);
    client.setQueryData(['benutzer'], []);
    mount(true, client);
    const quelle = FakeEventSource.instanzen[0];
    quelle.emit('einsatzliste');
    expect(client.getQueryState(['einsaetze'])?.isInvalidated).toBe(true);
    expect(client.getQueryState(['material', 'alle'])?.isInvalidated).toBe(false);
    quelle.emit('stammdaten');
    expect(client.getQueryState(['material', 'alle'])?.isInvalidated).toBe(true);
    const spy = vi.spyOn(client, 'invalidateQueries');
    quelle.emit('lagged', 'resync');
    expect(spy).toHaveBeenCalledWith({ queryKey: ['aufbewahrung'] });
    expect(client.getQueryState(['benutzer'])?.isInvalidated).toBe(false); // nicht live
  });

  it('ruht, solange ein Einsatz-Strom offen ist, und öffnet danach wieder', () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    mount(true);
    expect(FakeEventSource.offene()).toEqual(['/api/live']);

    let abmelden: () => void = () => {};
    act(() => {
      abmelden = meldeEinsatzStrom();
    });
    expect(FakeEventSource.offene()).toEqual([]);

    act(() => abmelden());
    expect(FakeEventSource.offene()).toEqual(['/api/live']);
    expect(FakeEventSource.instanzen).toHaveLength(2);
  });

  it('schließt die Verbindung beim Abmelden und beim Unmount', () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const { rerender, unmount } = mount(true);
    rerender(
      <QueryClientProvider client={neuerQueryClient()}>
        <Probe angemeldet={false} />
      </QueryClientProvider>,
    );
    expect(FakeEventSource.offene()).toEqual([]);
    unmount();
    expect(FakeEventSource.offene()).toEqual([]);
  });
});
