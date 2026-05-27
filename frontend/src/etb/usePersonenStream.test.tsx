import { render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClientProvider } from '@tanstack/react-query';
import { neuerQueryClient } from '../test/utils';
import { usePersonenStream } from './usePersonenStream';

class FakeEventSource {
  static letzte: FakeEventSource | null = null;
  url: string;
  closed = false;
  private listeners: Record<string, ((e: MessageEvent) => void)[]> = {};
  constructor(url: string) { this.url = url; FakeEventSource.letzte = this; }
  addEventListener(typ: string, cb: (e: MessageEvent) => void) { (this.listeners[typ] ??= []).push(cb); }
  removeEventListener(typ: string, cb: (e: MessageEvent) => void) {
    this.listeners[typ] = (this.listeners[typ] ?? []).filter((l) => l !== cb);
  }
  close() { this.closed = true; }
  emit(typ: string, data = '') { (this.listeners[typ] ?? []).forEach((cb) => cb(new MessageEvent(typ, { data }))); }
}

afterEach(() => vi.unstubAllGlobals());

function Probe({ id }: { id: number }) { usePersonenStream(id); return <div>aktiv</div>; }

describe('usePersonenStream', () => {
  it('öffnet den Personen-Stream und invalidiert nur die Liste bei person-Event', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const client = neuerQueryClient();
    const spy = vi.spyOn(client, 'invalidateQueries');
    render(
      <QueryClientProvider client={client}>
        <Probe id={7} />
      </QueryClientProvider>,
    );
    expect(FakeEventSource.letzte?.url).toBe('/api/einsaetze/7/personen/stream');
    FakeEventSource.letzte?.emit('person', '{"einsatz_id":7,"person_id":3}');
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: ['einsatz-personen', 7] }));
    // Detail-Query darf NICHT invalidiert werden:
    expect(spy).not.toHaveBeenCalledWith({ queryKey: ['einsatz-person', 7, 3] });
  });

  it('schließt die Verbindung beim Unmount', () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const client = neuerQueryClient();
    const { unmount } = render(
      <QueryClientProvider client={client}>
        <Probe id={3} />
      </QueryClientProvider>,
    );
    const es = FakeEventSource.letzte!;
    unmount();
    expect(es.closed).toBe(true);
  });
});
