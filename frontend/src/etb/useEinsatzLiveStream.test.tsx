import { render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClientProvider } from '@tanstack/react-query';
import { neuerQueryClient } from '../test/utils';
import { useEinsatzLiveStream } from './useEinsatzLiveStream';

class FakeEventSource {
  static letzte: FakeEventSource | null = null;
  url: string;
  closed = false;
  private listeners: Record<string, ((e: MessageEvent) => void)[]> = {};
  constructor(url: string) {
    this.url = url;
    FakeEventSource.letzte = this;
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
  emit(typ: string, data = '') {
    (this.listeners[typ] ?? []).forEach((cb) => cb(new MessageEvent(typ, { data })));
  }
}

afterEach(() => vi.unstubAllGlobals());

function Probe({ id }: { id: number }) {
  useEinsatzLiveStream(id);
  return <div>aktiv</div>;
}

describe('useEinsatzLiveStream', () => {
  it('invalidiert einsatz-personal, einsatz-fahrzeuge & einsatz-material bei einheit-Event', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const client = neuerQueryClient();
    const spy = vi.spyOn(client, 'invalidateQueries');
    render(
      <QueryClientProvider client={client}>
        <Probe id={1} />
      </QueryClientProvider>,
    );
    FakeEventSource.letzte?.emit('einheit');
    await waitFor(() => {
      const keys = spy.mock.calls.map((c) => (c[0] as { queryKey: string[] }).queryKey[0]);
      expect(keys).toContain('einsatz-personal');
      expect(keys).toContain('einsatz-fahrzeuge');
      expect(keys).toContain('einsatz-material');
    });
  });

  it('invalidiert einsatz-personal bei person-Event', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const client = neuerQueryClient();
    const spy = vi.spyOn(client, 'invalidateQueries');
    render(
      <QueryClientProvider client={client}>
        <Probe id={1} />
      </QueryClientProvider>,
    );
    FakeEventSource.letzte?.emit('person');
    await waitFor(() => {
      const keys = spy.mock.calls.map((c) => (c[0] as { queryKey: string[] }).queryKey[0]);
      expect(keys).toContain('einsatz-personal');
    });
  });

  it('invalidiert gefahrenmatrix bei gefahr-Event', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const client = neuerQueryClient();
    const spy = vi.spyOn(client, 'invalidateQueries');
    render(
      <QueryClientProvider client={client}>
        <Probe id={1} />
      </QueryClientProvider>,
    );
    FakeEventSource.letzte?.emit('gefahr');
    await waitFor(() => {
      const keys = spy.mock.calls.map((c) => (c[0] as { queryKey: string[] }).queryKey[0]);
      expect(keys).toContain('gefahrenmatrix');
    });
  });
});
