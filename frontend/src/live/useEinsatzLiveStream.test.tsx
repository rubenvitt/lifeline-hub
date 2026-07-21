import { http, HttpResponse } from 'msw';
import { render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClientProvider } from '@tanstack/react-query';
import { server } from '../test/server';
import { neuerQueryClient } from '../test/utils';
import { useEinsatzLiveStream } from './useEinsatzLiveStream';
import { SITZUNG_ABGELAUFEN, sitzungsMeldungZuruecksetzen } from '../auth/sitzungsEvent';

class FakeEventSource {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  static instanzen: FakeEventSource[] = [];
  static get letzte(): FakeEventSource | null {
    const arr = FakeEventSource.instanzen;
    return arr.length > 0 ? arr[arr.length - 1] : null;
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
    this.readyState = FakeEventSource.CLOSED;
  }
  emit(typ: string, data = '') {
    if (typ === 'open') {
      this.readyState = FakeEventSource.OPEN;
      this.onopen?.();
      return;
    }
    (this.listeners[typ] ?? []).forEach((cb) => cb(new MessageEvent(typ, { data })));
  }
  /** Simuliert einen Verbindungsfehler mit gegebenem readyState (CONNECTING=Auto-Reconnect,
   *  CLOSED=Browser gibt auf). */
  emitError(readyState: number) {
    this.readyState = readyState;
    this.onerror?.();
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  FakeEventSource.instanzen = [];
  // Die Melde-Sperre ist modulweit — ohne Reset bliebe der zweite 401-Test stumm (LFH-268).
  sitzungsMeldungZuruecksetzen();
});

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

  it('invalidiert einsatz-personal bei personal-Event (nicht bei person)', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const client = neuerQueryClient();
    const spy = vi.spyOn(client, 'invalidateQueries');
    render(
      <QueryClientProvider client={client}>
        <Probe id={1} />
      </QueryClientProvider>,
    );
    // F01/LFH-227: `personal` (Dispositionen) und `person` (betroffene Personen) sind
    // getrennte Wire-Events — nur so kann das Backend die zwei Module getrennt gaten.
    FakeEventSource.letzte?.emit('personal');
    await waitFor(() => {
      const keys = spy.mock.calls.map((c) => (c[0] as { queryKey: string[] }).queryKey[0]);
      expect(keys).toContain('einsatz-personal');
    });
    expect(
      spy.mock.calls.map((c) => (c[0] as { queryKey: string[] }).queryKey[0]),
    ).not.toContain('einsatz-personen');
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

  // LFH-207: pinnt die load-bearing Invalidierungen, bevor die dedizierten Per-Domäne-Hooks
  // (usePersonenStream/useUhsStream/useEtbStream, jeweils 2. EventSource) entfernt werden.
  it('invalidiert einsatz-uhs bei uhs-Event (LFH-207: ersetzt useUhsStream)', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const client = neuerQueryClient();
    const spy = vi.spyOn(client, 'invalidateQueries');
    render(
      <QueryClientProvider client={client}>
        <Probe id={8} />
      </QueryClientProvider>,
    );
    FakeEventSource.letzte?.emit('uhs');
    await waitFor(() => {
      const calls = spy.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey);
      expect(calls).toContainEqual(['einsatz-uhs', 8]);
    });
  });

  it('invalidiert einsatz-personen bei person-Event (LFH-207: ersetzt usePersonenStream/useUhsStream)', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const client = neuerQueryClient();
    const spy = vi.spyOn(client, 'invalidateQueries');
    render(
      <QueryClientProvider client={client}>
        <Probe id={8} />
      </QueryClientProvider>,
    );
    FakeEventSource.letzte?.emit('person');
    await waitFor(() => {
      const calls = spy.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey);
      expect(calls).toContainEqual(['einsatz-personen', 8]);
    });
  });

  it('invalidiert etb bei etb-Event (LFH-207-C: ersetzt useEtbStream)', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const client = neuerQueryClient();
    const spy = vi.spyOn(client, 'invalidateQueries');
    render(
      <QueryClientProvider client={client}>
        <Probe id={8} />
      </QueryClientProvider>,
    );
    FakeEventSource.letzte?.emit('etb');
    await waitFor(() => {
      const calls = spy.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey);
      expect(calls).toContainEqual(['etb', 8]);
    });
  });

  it('invalidiert etb auch im lagged-Fallback (LFH-207-C)', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const client = neuerQueryClient();
    const spy = vi.spyOn(client, 'invalidateQueries');
    render(
      <QueryClientProvider client={client}>
        <Probe id={8} />
      </QueryClientProvider>,
    );
    FakeEventSource.letzte?.emit('lagged');
    await waitFor(() => {
      const calls = spy.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey);
      expect(calls).toContainEqual(['etb', 8]);
    });
  });

  it('feuert lfh:erinnerung-alarm bei erinnerung-Event ohne Bezug (reine Erinnerung)', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const client = neuerQueryClient();
    const alarm = vi.fn();
    window.addEventListener('lfh:erinnerung-alarm', alarm);
    render(
      <QueryClientProvider client={client}>
        <Probe id={9} />
      </QueryClientProvider>,
    );
    FakeEventSource.letzte?.emit('erinnerung', JSON.stringify({ einsatz_id: 9, erinnerung_id: 5, bezug_typ: null, bezug_id: null }));
    await waitFor(() => expect(alarm).toHaveBeenCalled());
    window.removeEventListener('lfh:erinnerung-alarm', alarm);
  });

  it('invalidiert einsatz-auftraege und feuert Alarm bei erinnerung-Event mit bezug_typ=auftrag', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const client = neuerQueryClient();
    const spy = vi.spyOn(client, 'invalidateQueries');
    const alarm = vi.fn();
    window.addEventListener('lfh:erinnerung-alarm', alarm);
    render(
      <QueryClientProvider client={client}>
        <Probe id={9} />
      </QueryClientProvider>,
    );
    FakeEventSource.letzte?.emit('erinnerung', JSON.stringify({ einsatz_id: 9, erinnerung_id: 6, bezug_typ: 'auftrag', bezug_id: 12 }));
    await waitFor(() => {
      const calls = spy.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey);
      expect(calls).toContainEqual(['einsatz-auftraege', 9]);
      expect(alarm).toHaveBeenCalled();
    });
    window.removeEventListener('lfh:erinnerung-alarm', alarm);
  });

  it('feuert KEINEN erinnerung-Alarm bei bezug_typ=meldung (Doppel-Alarm-Guard, sofortmeldung trägt)', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const client = neuerQueryClient();
    const spy = vi.spyOn(client, 'invalidateQueries');
    const alarm = vi.fn();
    window.addEventListener('lfh:erinnerung-alarm', alarm);
    render(
      <QueryClientProvider client={client}>
        <Probe id={9} />
      </QueryClientProvider>,
    );
    FakeEventSource.letzte?.emit('erinnerung', JSON.stringify({ einsatz_id: 9, erinnerung_id: 7, bezug_typ: 'meldung', bezug_id: 3 }));
    // Registry-Invalidierung von einsatz-erinnerungen läuft trotzdem.
    await waitFor(() => {
      const calls = spy.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey);
      expect(calls).toContainEqual(['einsatz-erinnerungen', 9]);
    });
    expect(alarm).not.toHaveBeenCalled();
    window.removeEventListener('lfh:erinnerung-alarm', alarm);
  });

  it('feuert KEINEN erinnerung-Alarm bei CRUD-Refresh ohne erinnerung_id (routes/erinnerung.rs sse())', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const client = neuerQueryClient();
    const spy = vi.spyOn(client, 'invalidateQueries');
    const alarm = vi.fn();
    window.addEventListener('lfh:erinnerung-alarm', alarm);
    render(
      <QueryClientProvider client={client}>
        <Probe id={9} />
      </QueryClientProvider>,
    );
    FakeEventSource.letzte?.emit('erinnerung', JSON.stringify({ einsatz_id: 9 }));
    // Registry-Invalidierung von einsatz-erinnerungen läuft trotzdem (separater Listener).
    await waitFor(() => {
      const calls = spy.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey);
      expect(calls).toContainEqual(['einsatz-erinnerungen', 9]);
    });
    expect(alarm).not.toHaveBeenCalled();
    const auftraegeKeys = spy.mock.calls
      .map((c) => (c[0] as { queryKey: unknown[] }).queryKey)
      .filter((k) => k[0] === 'einsatz-auftraege');
    expect(auftraegeKeys).toHaveLength(0);
    window.removeEventListener('lfh:erinnerung-alarm', alarm);
  });

  // F14/LFH-263: Reconnect-Resync + sichtbarer Fehlerpfad.
  it('invalidiert beim ersten open NICHT und meldet Status open (skip-first, F14)', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const client = neuerQueryClient();
    const spy = vi.spyOn(client, 'invalidateQueries');
    const status: string[] = [];
    const onStatus = (e: Event) => status.push((e as CustomEvent<{ status: string }>).detail.status);
    window.addEventListener('lfh:live-status', onStatus);
    render(
      <QueryClientProvider client={client}>
        <Probe id={1} />
      </QueryClientProvider>,
    );
    FakeEventSource.letzte?.emit('open');
    await waitFor(() => expect(status).toContain('open'));
    expect(spy).not.toHaveBeenCalled(); // erstes open löst KEINEN Voll-Invalidate aus
    window.removeEventListener('lfh:live-status', onStatus);
  });

  it('invalidiert beim Re-Open alle Registry-Keys (Reconnect-Resync wie lagged, F14)', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const client = neuerQueryClient();
    const spy = vi.spyOn(client, 'invalidateQueries');
    render(
      <QueryClientProvider client={client}>
        <Probe id={3} />
      </QueryClientProvider>,
    );
    const quelle = FakeEventSource.letzte;
    quelle?.emit('open'); // erstes open → skip
    spy.mockClear();
    quelle?.emit('open'); // Reconnect → Voll-Resync
    await waitFor(() => {
      const calls = spy.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey);
      expect(calls).toContainEqual(['einsatz-uhs', 3]);
      expect(calls).toContainEqual(['etb', 3]);
    });
  });

  it('meldet connecting bei transientem Fehler (readyState CONNECTING, F14)', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const client = neuerQueryClient();
    const status: string[] = [];
    const onStatus = (e: Event) => status.push((e as CustomEvent<{ status: string }>).detail.status);
    window.addEventListener('lfh:live-status', onStatus);
    render(
      <QueryClientProvider client={client}>
        <Probe id={1} />
      </QueryClientProvider>,
    );
    FakeEventSource.letzte?.emitError(FakeEventSource.CONNECTING);
    await waitFor(() => expect(status).toContain('connecting'));
    window.removeEventListener('lfh:live-status', onStatus);
  });

  it('leitet bei CLOSED-Fehler mit 401 in den Login-Flow (F14)', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    server.use(http.get('/api/auth/me', () => HttpResponse.json({ error: 'x' }, { status: 401 })));
    const authVerloren = vi.fn();
    window.addEventListener(SITZUNG_ABGELAUFEN, authVerloren);
    const status: string[] = [];
    const onStatus = (e: Event) => status.push((e as CustomEvent<{ status: string }>).detail.status);
    window.addEventListener('lfh:live-status', onStatus);
    const client = neuerQueryClient();
    render(
      <QueryClientProvider client={client}>
        <Probe id={1} />
      </QueryClientProvider>,
    );
    FakeEventSource.letzte?.emitError(FakeEventSource.CLOSED);
    await waitFor(() => expect(authVerloren).toHaveBeenCalled());
    expect(status).toContain('lost');
    window.removeEventListener(SITZUNG_ABGELAUFEN, authVerloren);
    window.removeEventListener('lfh:live-status', onStatus);
  });

  it('reconnectet nach CLOSED-Fehler bei gültiger Session statt Login (F14)', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    server.use(http.get('/api/auth/me', () => HttpResponse.json({ id: 1 }, { status: 200 })));
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const authVerloren = vi.fn();
    window.addEventListener(SITZUNG_ABGELAUFEN, authVerloren);
    const client = neuerQueryClient();
    render(
      <QueryClientProvider client={client}>
        <Probe id={1} />
      </QueryClientProvider>,
    );
    const quelle = FakeEventSource.letzte;
    setTimeoutSpy.mockClear();
    quelle?.emitError(FakeEventSource.CLOSED);
    await waitFor(() =>
      expect(setTimeoutSpy.mock.calls.some(([, d]) => d === 1000)).toBe(true),
    );
    expect(authVerloren).not.toHaveBeenCalled();
    expect(quelle?.closed).toBe(true); // tote Quelle vor Reconnect geschlossen
    window.removeEventListener(SITZUNG_ABGELAUFEN, authVerloren);
    setTimeoutSpy.mockRestore();
  });
});
