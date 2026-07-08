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

  it('invalidiert einsatz-material bei material-Event', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const client = neuerQueryClient();
    const spy = vi.spyOn(client, 'invalidateQueries');
    render(
      <QueryClientProvider client={client}>
        <Probe id={1} />
      </QueryClientProvider>,
    );
    FakeEventSource.letzte?.emit('material');
    await waitFor(() => {
      const keys = spy.mock.calls.map((c) => (c[0] as { queryKey: string[] }).queryKey[0]);
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

  it('invalidiert einsatz-chat-kanaele und einsatz-chat-nachrichten bei chat-Event', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const client = neuerQueryClient();
    const spy = vi.spyOn(client, 'invalidateQueries');
    render(
      <QueryClientProvider client={client}>
        <Probe id={42} />
      </QueryClientProvider>,
    );
    FakeEventSource.letzte?.emit('chat');
    await waitFor(() => {
      const calls = spy.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey);
      expect(calls).toContainEqual(['einsatz-chat-kanaele', 42]);
      expect(calls).toContainEqual(['einsatz-chat-nachrichten', 42]);
    });
  });

  it('invalidiert einsatz-meldungen und feuert window-Alarm bei sofortmeldung-Event (LFH-97)', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const client = neuerQueryClient();
    const spy = vi.spyOn(client, 'invalidateQueries');
    const alarm = vi.fn();
    window.addEventListener('lfh:sofortmeldung', alarm);
    render(
      <QueryClientProvider client={client}>
        <Probe id={7} />
      </QueryClientProvider>,
    );
    FakeEventSource.letzte?.emit('sofortmeldung', JSON.stringify({ einsatz_id: 7, meldung_id: 3 }));
    await waitFor(() => {
      const keys = spy.mock.calls.map((c) => (c[0] as { queryKey: string[] }).queryKey[0]);
      expect(keys).toContain('einsatz-meldungen');
      expect(alarm).toHaveBeenCalled();
    });
    window.removeEventListener('lfh:sofortmeldung', alarm);
  });

  it('invalidiert einsatz-tiere bei tier-Event (LFH-75)', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const client = neuerQueryClient();
    const spy = vi.spyOn(client, 'invalidateQueries');
    render(
      <QueryClientProvider client={client}>
        <Probe id={3} />
      </QueryClientProvider>,
    );
    FakeEventSource.letzte?.emit('tier');
    await waitFor(() => {
      const calls = spy.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey);
      expect(calls).toContainEqual(['einsatz-tiere', 3]);
    });
  });

  it('invalidiert einsatz-tiere und einsatz-schaeden im lagged-Fallback (LFH-75/206)', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const client = neuerQueryClient();
    const spy = vi.spyOn(client, 'invalidateQueries');
    render(
      <QueryClientProvider client={client}>
        <Probe id={3} />
      </QueryClientProvider>,
    );
    FakeEventSource.letzte?.emit('lagged');
    await waitFor(() => {
      const calls = spy.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey);
      // Reconnect/Overflow ist die einzige verbleibende Absicherung, seit die dedizierten
      // useTiereStream (LFH-75) / useSchaedenStream (LFH-206) entfernt wurden.
      expect(calls).toContainEqual(['einsatz-tiere', 3]);
      expect(calls).toContainEqual(['einsatz-schaeden', 3]);
    });
  });

  // LFH-206: pinnt, dass der konsolidierte Stream `einsatz-schaeden` live hält —
  // Voraussetzung dafür, den dedizierten useSchaedenStream (2. EventSource) zu entfernen.
  it('invalidiert einsatz-schaeden bei schaden-Event (LFH-206)', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const client = neuerQueryClient();
    const spy = vi.spyOn(client, 'invalidateQueries');
    render(
      <QueryClientProvider client={client}>
        <Probe id={3} />
      </QueryClientProvider>,
    );
    FakeEventSource.letzte?.emit('schaden');
    await waitFor(() => {
      const calls = spy.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey);
      expect(calls).toContainEqual(['einsatz-schaeden', 3]);
    });
  });

  // LFH-122: Der lagged-Vollabgleich (Reconnect/Overflow) deckt einen breiten Querschnitt
  // ab (Union aller Event-Keys), löst aber BEWUSST keinen Sofort-Alarm aus — sonst Fehlalarm
  // ohne neue Sofortmeldung. Pinnt beides vor dem Registry-Refactor.
  it('invalidiert breit und feuert KEINEN window-Alarm bei lagged-Event (LFH-122)', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const client = neuerQueryClient();
    const spy = vi.spyOn(client, 'invalidateQueries');
    const alarm = vi.fn();
    window.addEventListener('lfh:sofortmeldung', alarm);
    render(
      <QueryClientProvider client={client}>
        <Probe id={5} />
      </QueryClientProvider>,
    );
    FakeEventSource.letzte?.emit('lagged');
    await waitFor(() => {
      const calls = spy.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey);
      expect(calls).toContainEqual(['einsatz-uhs', 5]);
      expect(calls).toContainEqual(['einsatz-br', 5]);
      expect(calls).toContainEqual(['einsatz-kartenbilder', 5]);
      expect(calls).toContainEqual(['einsatz-meldungen', 5]);
    });
    expect(alarm).not.toHaveBeenCalled();
    window.removeEventListener('lfh:sofortmeldung', alarm);
  });
});
