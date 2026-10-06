import { http, HttpResponse } from 'msw';
import { render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { server } from '../test/server';
import { neuerQueryClient } from '../test/utils';
import { useEinsatzLiveStream } from './useEinsatzLiveStream';
import { LIVE_SAMMELFENSTER_MS, ZAEHLER_SAMMELFENSTER_MS } from './liveInvalidierung';
import { WIEDERAUFBAU_SCHONFRIST_MS } from './liveVerbindung';
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
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  FakeEventSource.instanzen = [];
  // Die Melde-Sperre ist modulweit — ohne Reset bliebe der zweite 401-Test stumm.
  sitzungsMeldungZuruecksetzen();
});

/** Die Argumente, mit denen der Sammler einen Key abgleicht (LFH-922, liveInvalidierung.ts). */
function abgleich(queryKey: unknown[], refetchType: 'active' | 'none' = 'active') {
  return [{ queryKey, refetchType }, { cancelRefetch: false }] as const;
}

/** Alle invalidierten Keys, in der Reihenfolge der Aufrufe. */
function keysVon(spy: { mock: { calls: unknown[][] } }): unknown[][] {
  return spy.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey);
}

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
    // `personal` (Dispositionen) und `person` (betroffene Personen) sind getrennte Wire-Events,
    // damit das Backend die Module getrennt gaten kann.
    FakeEventSource.letzte?.emit('personal');
    await waitFor(() => {
      const keys = spy.mock.calls.map((c) => (c[0] as { queryKey: string[] }).queryKey[0]);
      expect(keys).toContain('einsatz-personal');
    });
    expect(spy.mock.calls.map((c) => (c[0] as { queryKey: string[] }).queryKey[0])).not.toContain(
      'einsatz-personen',
    );
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
      // Reconnect/Overflow ist die einzige Absicherung dieser Keys ohne eigenes Event.
      expect(calls).toContainEqual(['einsatz-tiere', 3]);
      expect(calls).toContainEqual(['einsatz-schaeden', 3]);
    });
  });

  it('invalidiert Einsatzkopf und Stab-Anzeige bei einsatz-Event (LFH-555)', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const client = neuerQueryClient();
    const spy = vi.spyOn(client, 'invalidateQueries');
    render(
      <QueryClientProvider client={client}>
        <Probe id={3} />
      </QueryClientProvider>,
    );
    FakeEventSource.letzte?.emit('einsatz', JSON.stringify({ einsatz_id: 3 }));
    await waitFor(() => {
      const calls = spy.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey);
      expect(calls).toContainEqual(['einsatz', 3]);
      expect(calls).toContainEqual(['einsatz-stab', 3]);
    });
  });

  it('nimmt den Einsatzkopf in den lagged-Vollabgleich auf (LFH-555)', async () => {
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
      expect(calls).toContainEqual(['einsatz', 3]);
    });
  });

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

  // Der lagged-Vollabgleich invalidiert breit (Union aller Event-Keys), löst aber BEWUSST keinen
  // Sofort-Alarm aus — sonst Fehlalarm ohne neue Sofortmeldung.
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
    FakeEventSource.letzte?.emit(
      'erinnerung',
      JSON.stringify({ einsatz_id: 9, erinnerung_id: 5, bezug_typ: null, bezug_id: null }),
    );
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
    FakeEventSource.letzte?.emit(
      'erinnerung',
      JSON.stringify({ einsatz_id: 9, erinnerung_id: 6, bezug_typ: 'auftrag', bezug_id: 12 }),
    );
    await waitFor(() => {
      const calls = spy.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey);
      expect(calls).toContainEqual(['einsatz-auftraege', 9]);
      expect(alarm).toHaveBeenCalled();
    });
    window.removeEventListener('lfh:erinnerung-alarm', alarm);
  });

  it('LFH-635: abloesung mit art alarmiert, ohne art nur Refresh; Ablösungsfristen nicht als Erinnerung', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const client = neuerQueryClient();
    const spy = vi.spyOn(client, 'invalidateQueries');
    const abloesung = vi.fn();
    const erinnerung = vi.fn();
    window.addEventListener('lfh:abloesung-alarm', abloesung);
    window.addEventListener('lfh:erinnerung-alarm', erinnerung);
    render(
      <QueryClientProvider client={client}>
        <Probe id={9} />
      </QueryClientProvider>,
    );
    FakeEventSource.letzte?.emit('abloesung', JSON.stringify({ einsatz_id: 9 }));
    await waitFor(() => {
      const calls = spy.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey);
      expect(calls).toContainEqual(['einsatz-abloesungen', 9]);
    });
    expect(abloesung).not.toHaveBeenCalled();
    FakeEventSource.letzte?.emit(
      'abloesung',
      JSON.stringify({ einsatz_id: 9, abloesung_id: 4, art: 'faellig', titel: 'x' }),
    );
    await waitFor(() => expect(abloesung).toHaveBeenCalledTimes(1));
    FakeEventSource.letzte?.emit(
      'erinnerung',
      JSON.stringify({ einsatz_id: 9, erinnerung_id: 8, bezug_typ: 'abloesung', bezug_id: 4 }),
    );
    FakeEventSource.letzte?.emit(
      'erinnerung',
      JSON.stringify({
        einsatz_id: 9,
        erinnerung_id: 9,
        bezug_typ: 'abloesung_vorwarnung',
        bezug_id: 4,
      }),
    );
    await waitFor(() => {
      const calls = spy.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey);
      expect(calls).toContainEqual(['einsatz-erinnerungen', 9]);
    });
    expect(erinnerung).not.toHaveBeenCalled();
    window.removeEventListener('lfh:abloesung-alarm', abloesung);
    window.removeEventListener('lfh:erinnerung-alarm', erinnerung);
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
    FakeEventSource.letzte?.emit(
      'erinnerung',
      JSON.stringify({ einsatz_id: 9, erinnerung_id: 7, bezug_typ: 'meldung', bezug_id: 3 }),
    );
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

  // Reconnect-Resync + sichtbarer Fehlerpfad.
  it('invalidiert beim ersten open keinen Einsatz-Key und meldet Status open (skip-first, F14)', () => {
    vi.useFakeTimers();
    vi.stubGlobal('EventSource', FakeEventSource);
    const client = neuerQueryClient();
    const spy = vi.spyOn(client, 'invalidateQueries');
    const status: string[] = [];
    const onStatus = (e: Event) =>
      status.push((e as CustomEvent<{ status: string }>).detail.status);
    window.addEventListener('lfh:live-status', onStatus);
    render(
      <QueryClientProvider client={client}>
        <Probe id={1} />
      </QueryClientProvider>,
    );
    FakeEventSource.letzte?.emit('open');
    expect(status).toContain('open');
    vi.advanceTimersByTime(LIVE_SAMMELFENSTER_MS);
    // Erstes open: KEIN Einsatz-Vollabgleich (die Abfragen laden beim Mount ohnehin) …
    const keys = keysVon(spy);
    expect(keys.filter((k) => typeof k[1] === 'number')).toEqual([]);
    // … aber die Org-Keys (LFH-734): beim Wechsel aus dem Org-Strom kann ein Org-Ereignis
    // zwischen beiden Verbindungen verloren gehen.
    expect(keys).toContainEqual(['einsaetze']);
    expect(keys).toContainEqual(['fahrzeuge']);
    window.removeEventListener('lfh:live-status', onStatus);
  });

  // LFH-922, design.md D3: verbindet der Browser dieselbe EventSource neu, liefert der Server per
  // `Last-Event-ID` nach (oder meldet `lagged`). Dann gleichen nur die Org-Keys ab, die keinen
  // Nachlieferweg haben.
  it('gleicht beim Neuaufbau durch den Browser nur die Org-Keys ab (Nachlieferung, LFH-922)', () => {
    vi.useFakeTimers();
    vi.stubGlobal('EventSource', FakeEventSource);
    const client = neuerQueryClient();
    const spy = vi.spyOn(client, 'invalidateQueries');
    render(
      <QueryClientProvider client={client}>
        <Probe id={3} />
      </QueryClientProvider>,
    );
    const quelle = FakeEventSource.letzte!;
    quelle.emit('open'); // erstes open
    quelle.emit('position', '{}'); // der Server hat seine Position genannt
    vi.advanceTimersByTime(LIVE_SAMMELFENSTER_MS);
    spy.mockClear();
    quelle.emitError(FakeEventSource.CONNECTING);
    quelle.emit('open'); // der Browser hat dieselbe Quelle neu verbunden
    vi.advanceTimersByTime(LIVE_SAMMELFENSTER_MS);
    const keys = keysVon(spy);
    expect(keys.filter((k) => typeof k[1] === 'number')).toEqual([]);
    expect(keys).toContainEqual(['einsaetze']);
    expect(keys).toContainEqual(['fahrzeuge']);
    expect(FakeEventSource.instanzen).toHaveLength(1);
  });

  // Riss die Leitung vor der Position, kennt der Browser keine `Last-Event-ID`: der Server
  // liefert dann nichts nach, also gleicht der Tab ab wie bei einer neuen Verbindung.
  it('gleicht beim Neuaufbau ohne erhaltene Position voll ab (LFH-922)', () => {
    vi.useFakeTimers();
    vi.stubGlobal('EventSource', FakeEventSource);
    const client = neuerQueryClient();
    const spy = vi.spyOn(client, 'invalidateQueries');
    render(
      <QueryClientProvider client={client}>
        <Probe id={3} />
      </QueryClientProvider>,
    );
    const quelle = FakeEventSource.letzte!;
    quelle.emit('open');
    vi.advanceTimersByTime(LIVE_SAMMELFENSTER_MS);
    spy.mockClear();
    quelle.emitError(FakeEventSource.CONNECTING);
    quelle.emit('open');
    vi.advanceTimersByTime(LIVE_SAMMELFENSTER_MS);
    expect(spy).toHaveBeenCalledWith(...abgleich(['etb', 3]));
    expect(spy).toHaveBeenCalledWith(...abgleich(['einsatz-uhs', 3]));
    expect(spy).toHaveBeenCalledWith(...abgleich(['einsaetze']));
  });

  it('gleicht nach einem Neuaufbau mit neuer Verbindung alle Registry-Keys ab (F14)', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    vi.spyOn(Math, 'random').mockReturnValue(0);
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json({ id: 3 }, { status: 200 })),
      http.get('/api/einsaetze/3', () => HttpResponse.json({ id: 3 }, { status: 200 })),
    );
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const client = neuerQueryClient();
    const spy = vi.spyOn(client, 'invalidateQueries');
    render(
      <QueryClientProvider client={client}>
        <Probe id={3} />
      </QueryClientProvider>,
    );
    const erste = FakeEventSource.letzte!;
    erste.emit('open');
    erste.emitError(FakeEventSource.CLOSED);
    await waitFor(() => expect(setTimeoutSpy.mock.calls.some(([, d]) => d === 1000)).toBe(true));
    const [neuaufbau] = setTimeoutSpy.mock.calls.find(([, d]) => d === 1000)!;
    (neuaufbau as () => void)();
    const zweite = FakeEventSource.letzte!;
    expect(zweite).not.toBe(erste);
    spy.mockClear();
    zweite.emit('open'); // neue Verbindung ohne Last-Event-ID → Vollabgleich
    await waitFor(() => {
      expect(spy).toHaveBeenCalledWith(...abgleich(['einsatz-uhs', 3]));
      expect(spy).toHaveBeenCalledWith(...abgleich(['etb', 3]));
      expect(spy).toHaveBeenCalledWith(...abgleich(['einsaetze']));
    });
  });

  it('bündelt einen Burst zu je einem Abgleich je Key, ohne laufende Abrufe abzubrechen (LFH-922)', () => {
    vi.useFakeTimers();
    vi.stubGlobal('EventSource', FakeEventSource);
    const client = neuerQueryClient();
    const spy = vi.spyOn(client, 'invalidateQueries');
    render(
      <QueryClientProvider client={client}>
        <Probe id={3} />
      </QueryClientProvider>,
    );
    const quelle = FakeEventSource.letzte!;
    for (let i = 0; i < 50; i += 1) quelle.emit(i % 2 === 0 ? 'etb' : 'einheit');
    expect(spy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(LIVE_SAMMELFENSTER_MS);
    const keys = keysVon(spy).map((k) => JSON.stringify(k));
    expect(new Set(keys).size).toBe(keys.length);
    expect(spy).toHaveBeenCalledWith(...abgleich(['etb', 3]));
    expect(spy).toHaveBeenCalledWith(...abgleich(['einsatz-personal', 3]));
    expect(spy).toHaveBeenCalledWith(...abgleich(['einsatz-fahrzeuge', 3]));
  });

  it('ruft die Modulzähler je Burst einmal ab, die Listen im eigenen Fenster (LFH-935)', () => {
    vi.useFakeTimers();
    vi.stubGlobal('EventSource', FakeEventSource);
    const client = neuerQueryClient();
    const spy = vi.spyOn(client, 'invalidateQueries');
    render(
      <QueryClientProvider client={client}>
        <Probe id={3} />
      </QueryClientProvider>,
    );
    const quelle = FakeEventSource.letzte!;
    const zaehler = (k: unknown[]) =>
      JSON.stringify(k) === JSON.stringify(['einsatz-modul-zaehler', 3]);
    // Zehn Ereignisse in 500 ms.
    for (let i = 0; i < 10; i += 1) {
      quelle.emit('meldung');
      vi.advanceTimersByTime(50);
    }
    // Die Liste kam schon im 300-ms-Fenster, der Zähler noch nicht.
    expect(spy).toHaveBeenCalledWith(...abgleich(['einsatz-meldungen', 3]));
    expect(keysVon(spy).filter(zaehler)).toHaveLength(0);
    vi.advanceTimersByTime(ZAEHLER_SAMMELFENSTER_MS);
    expect(keysVon(spy).filter(zaehler)).toHaveLength(1);
    expect(spy).toHaveBeenCalledWith(...abgleich(['einsatz-modul-zaehler', 3]));
  });

  it('merkt die Modulzähler auch bei lagged im eigenen Fenster vor (LFH-935)', () => {
    vi.useFakeTimers();
    vi.stubGlobal('EventSource', FakeEventSource);
    const client = neuerQueryClient();
    const spy = vi.spyOn(client, 'invalidateQueries');
    render(
      <QueryClientProvider client={client}>
        <Probe id={3} />
      </QueryClientProvider>,
    );
    FakeEventSource.letzte!.emit('lagged');
    vi.advanceTimersByTime(LIVE_SAMMELFENSTER_MS);
    expect(spy).toHaveBeenCalledWith(...abgleich(['etb', 3]));
    expect(spy).not.toHaveBeenCalledWith(...abgleich(['einsatz-modul-zaehler', 3]));
    vi.advanceTimersByTime(ZAEHLER_SAMMELFENSTER_MS - LIVE_SAMMELFENSTER_MS);
    expect(spy).toHaveBeenCalledWith(...abgleich(['einsatz-modul-zaehler', 3]));
  });

  it('markiert vorgemerkte Modulzähler beim Verlassen nur (LFH-935)', () => {
    vi.useFakeTimers();
    vi.stubGlobal('EventSource', FakeEventSource);
    const client = neuerQueryClient();
    const spy = vi.spyOn(client, 'invalidateQueries');
    const { unmount } = render(
      <QueryClientProvider client={client}>
        <Probe id={3} />
      </QueryClientProvider>,
    );
    FakeEventSource.letzte!.emit('etb');
    unmount();
    expect(spy).toHaveBeenCalledWith(...abgleich(['einsatz-modul-zaehler', 3], 'none'));
    vi.advanceTimersByTime(ZAEHLER_SAMMELFENSTER_MS);
    expect(spy).not.toHaveBeenCalledWith(...abgleich(['einsatz-modul-zaehler', 3]));
  });

  it('ruft in einem verdeckten Tab nicht ab, sondern markiert nur (LFH-922)', () => {
    vi.useFakeTimers();
    vi.stubGlobal('EventSource', FakeEventSource);
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    const client = neuerQueryClient();
    const spy = vi.spyOn(client, 'invalidateQueries');
    render(
      <QueryClientProvider client={client}>
        <Probe id={3} />
      </QueryClientProvider>,
    );
    FakeEventSource.letzte!.emit('etb');
    vi.advanceTimersByTime(LIVE_SAMMELFENSTER_MS);
    expect(spy).toHaveBeenCalledWith(...abgleich(['etb', 3], 'none'));
    expect(spy).not.toHaveBeenCalledWith(...abgleich(['etb', 3]));
  });

  it('alarmiert bei sofortmeldung sofort, der Abgleich folgt im Fenster (LFH-922)', () => {
    vi.useFakeTimers();
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
    FakeEventSource.letzte!.emit('sofortmeldung', JSON.stringify({ einsatz_id: 7, meldung_id: 3 }));
    expect(alarm).toHaveBeenCalledTimes(1);
    expect(spy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(LIVE_SAMMELFENSTER_MS);
    expect(spy).toHaveBeenCalledWith(...abgleich(['einsatz-meldungen', 7]));
    window.removeEventListener('lfh:sofortmeldung', alarm);
  });

  it('macht aus lagged direkt nach einem Vollabgleich nur eine Abrufwelle (LFH-922)', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json({ id: 1 }, { status: 200 })),
      http.get('/api/einsaetze/1', () =>
        HttpResponse.json({ error: 'Kein Zugriff' }, { status: 403 }),
      ),
    );
    const client = neuerQueryClient();
    const spy = vi.spyOn(client, 'invalidateQueries');
    render(
      <QueryClientProvider client={client}>
        <Probe id={1} />
      </QueryClientProvider>,
    );
    // Endzustand, dann Wiedergewähren: die neue Verbindung gleicht beim Erst-Open voll ab.
    FakeEventSource.letzte!.emitError(FakeEventSource.CLOSED);
    await waitFor(() => expect(keysVon(spy)).toContainEqual(['einsatz', 1]));
    await client.fetchQuery({ queryKey: ['einsatz', 1], queryFn: () => ({ id: 1 }) });
    const neue = FakeEventSource.letzte!;
    vi.useFakeTimers();
    spy.mockClear();
    neue.emit('open');
    neue.emit('lagged', 'resync');
    vi.advanceTimersByTime(LIVE_SAMMELFENSTER_MS);
    const keys = keysVon(spy).map((k) => JSON.stringify(k));
    expect(keys).toContain(JSON.stringify(['einsatz-material', 1]));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('meldet connecting erst nach der Schonfrist (readyState CONNECTING, F14, LFH-922)', () => {
    vi.useFakeTimers();
    vi.stubGlobal('EventSource', FakeEventSource);
    const client = neuerQueryClient();
    const status: string[] = [];
    const onStatus = (e: Event) =>
      status.push((e as CustomEvent<{ status: string }>).detail.status);
    window.addEventListener('lfh:live-status', onStatus);
    render(
      <QueryClientProvider client={client}>
        <Probe id={1} />
      </QueryClientProvider>,
    );
    expect(WIEDERAUFBAU_SCHONFRIST_MS).toBe(8000);
    const quelle = FakeEventSource.letzte!;
    quelle.emit('open');
    quelle.emitError(FakeEventSource.CONNECTING);
    vi.advanceTimersByTime(WIEDERAUFBAU_SCHONFRIST_MS - 1);
    expect(status).not.toContain('connecting');
    // Ein weiterer Fehlversuch des Browsers verlängert die Frist nicht.
    quelle.emitError(FakeEventSource.CONNECTING);
    vi.advanceTimersByTime(1);
    expect(status[status.length - 1]).toBe('connecting');
    window.removeEventListener('lfh:live-status', onStatus);
  });

  it('zeigt einen kurzen Abriss mit open in der Schonfrist gar nicht an (LFH-922)', () => {
    vi.useFakeTimers();
    vi.stubGlobal('EventSource', FakeEventSource);
    const status: string[] = [];
    const onStatus = (e: Event) =>
      status.push((e as CustomEvent<{ status: string }>).detail.status);
    window.addEventListener('lfh:live-status', onStatus);
    render(
      <QueryClientProvider client={neuerQueryClient()}>
        <Probe id={1} />
      </QueryClientProvider>,
    );
    const quelle = FakeEventSource.letzte!;
    quelle.emit('open');
    quelle.emitError(FakeEventSource.CONNECTING);
    vi.advanceTimersByTime(WIEDERAUFBAU_SCHONFRIST_MS - 1);
    quelle.emit('open');
    vi.advanceTimersByTime(WIEDERAUFBAU_SCHONFRIST_MS * 2);
    expect(status).not.toContain('connecting');
    expect(status[status.length - 1]).toBe('open');
    window.removeEventListener('lfh:live-status', onStatus);
  });

  it('meldet lost sofort, wenn der Browser aufgibt, auch in der Schonfrist (LFH-922)', () => {
    vi.useFakeTimers();
    vi.stubGlobal('EventSource', FakeEventSource);
    vi.stubGlobal('fetch', () => new Promise(() => {}));
    const status: string[] = [];
    const onStatus = (e: Event) =>
      status.push((e as CustomEvent<{ status: string }>).detail.status);
    window.addEventListener('lfh:live-status', onStatus);
    render(
      <QueryClientProvider client={neuerQueryClient()}>
        <Probe id={1} />
      </QueryClientProvider>,
    );
    const quelle = FakeEventSource.letzte!;
    quelle.emit('open');
    quelle.emitError(FakeEventSource.CONNECTING);
    quelle.emitError(FakeEventSource.CLOSED);
    expect(status[status.length - 1]).toBe('lost');
    vi.advanceTimersByTime(WIEDERAUFBAU_SCHONFRIST_MS);
    expect(status[status.length - 1]).toBe('lost');
    window.removeEventListener('lfh:live-status', onStatus);
  });

  it('meldet beim Unmount idle, damit der globale Hinweis nicht auf anderen Routen stehenbleibt', () => {
    vi.useFakeTimers();
    vi.stubGlobal('EventSource', FakeEventSource);
    const status: string[] = [];
    const onStatus = (e: Event) =>
      status.push((e as CustomEvent<{ status: string }>).detail.status);
    window.addEventListener('lfh:live-status', onStatus);
    const { unmount } = render(
      <QueryClientProvider client={neuerQueryClient()}>
        <Probe id={1} />
      </QueryClientProvider>,
    );

    FakeEventSource.letzte?.emitError(FakeEventSource.CONNECTING);
    vi.advanceTimersByTime(WIEDERAUFBAU_SCHONFRIST_MS);
    expect(status).toContain('connecting');
    unmount();
    expect(status[status.length - 1]).toBe('idle');
    // Auch eine laufende Schonfrist meldet nach dem Unmount nichts mehr.
    FakeEventSource.letzte?.emitError(FakeEventSource.CONNECTING);
    vi.advanceTimersByTime(WIEDERAUFBAU_SCHONFRIST_MS);
    expect(status[status.length - 1]).toBe('idle');
    window.removeEventListener('lfh:live-status', onStatus);
  });

  it('leitet bei CLOSED-Fehler mit 401 in den Login-Flow (F14)', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    let einsatzProben = 0;
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json({ error: 'x' }, { status: 401 })),
      http.get('/api/einsaetze/1', () => {
        einsatzProben += 1;
        return HttpResponse.json({ error: 'x' }, { status: 401 });
      }),
    );
    const authVerloren = vi.fn();
    window.addEventListener(SITZUNG_ABGELAUFEN, authVerloren);
    const status: string[] = [];
    const onStatus = (e: Event) =>
      status.push((e as CustomEvent<{ status: string }>).detail.status);
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
    // LFH-732: der 401-Pfad bleibt unverändert — die Einsatzprobe läuft erst bei gültiger Sitzung.
    expect(einsatzProben).toBe(0);
    window.removeEventListener(SITZUNG_ABGELAUFEN, authVerloren);
    window.removeEventListener('lfh:live-status', onStatus);
  });

  it('reconnectet nach CLOSED-Fehler bei gültiger Session statt Login (F14)', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    vi.spyOn(Math, 'random').mockReturnValue(0);
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json({ id: 1 }, { status: 200 })),
      http.get('/api/einsaetze/1', () => HttpResponse.json({ id: 1 }, { status: 200 })),
    );
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
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
    await waitFor(() => expect(setTimeoutSpy.mock.calls.some(([, d]) => d === 1000)).toBe(true));
    expect(timeoutSpy).toHaveBeenCalledWith(15_000);
    expect(authVerloren).not.toHaveBeenCalled();
    expect(quelle?.closed).toBe(true); // tote Quelle vor Reconnect geschlossen
    window.removeEventListener(SITZUNG_ABGELAUFEN, authVerloren);
    setTimeoutSpy.mockRestore();
    timeoutSpy.mockRestore();
  });

  it('beendet die Wiederverbindung, wenn der Einsatz nicht mehr existiert (404, LFH-732)', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json({ id: 1 }, { status: 200 })),
      http.get('/api/einsaetze/1', () =>
        HttpResponse.json({ error: 'Nicht gefunden' }, { status: 404 }),
      ),
    );
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const authVerloren = vi.fn();
    window.addEventListener(SITZUNG_ABGELAUFEN, authVerloren);
    const status: string[] = [];
    const onStatus = (e: Event) =>
      status.push((e as CustomEvent<{ status: string }>).detail.status);
    window.addEventListener('lfh:live-status', onStatus);
    const client = neuerQueryClient();
    const spy = vi.spyOn(client, 'invalidateQueries');
    render(
      <QueryClientProvider client={client}>
        <Probe id={1} />
      </QueryClientProvider>,
    );
    const quelle = FakeEventSource.letzte;
    setTimeoutSpy.mockClear();
    quelle?.emitError(FakeEventSource.CLOSED);

    // Der Einsatzkopf wird neu geholt: sein 404 führt den Rahmen in die vorhandene Sackgasse.
    await waitFor(() => {
      const calls = spy.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey);
      expect(calls).toContainEqual(['einsatz', 1]);
    });
    // Kein weiterer Verbindungsversuch: kein Backoff-Timer, keine zweite Quelle.
    expect(setTimeoutSpy.mock.calls.some(([, d]) => d === 1000)).toBe(false);
    expect(FakeEventSource.instanzen).toHaveLength(1);
    expect(quelle?.closed).toBe(true);
    // Die Sackgasse sagt den Fehler; die Betriebszeile meldet keine unterbrochene Leitung dazu.
    expect(status[status.length - 1]).toBe('idle');
    expect(authVerloren).not.toHaveBeenCalled();
    window.removeEventListener(SITZUNG_ABGELAUFEN, authVerloren);
    window.removeEventListener('lfh:live-status', onStatus);
    setTimeoutSpy.mockRestore();
  });

  it('beendet die Wiederverbindung, wenn der Zugriff auf den Einsatz entzogen ist (403, LFH-910)', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json({ id: 1 }, { status: 200 })),
      http.get('/api/einsaetze/1', () =>
        HttpResponse.json({ error: 'Kein Zugriff' }, { status: 403 }),
      ),
    );
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const authVerloren = vi.fn();
    window.addEventListener(SITZUNG_ABGELAUFEN, authVerloren);
    const status: string[] = [];
    const onStatus = (e: Event) =>
      status.push((e as CustomEvent<{ status: string }>).detail.status);
    window.addEventListener('lfh:live-status', onStatus);
    const client = neuerQueryClient();
    const spy = vi.spyOn(client, 'invalidateQueries');
    render(
      <QueryClientProvider client={client}>
        <Probe id={1} />
      </QueryClientProvider>,
    );
    const quelle = FakeEventSource.letzte;
    setTimeoutSpy.mockClear();
    quelle?.emitError(FakeEventSource.CLOSED);

    // Der Einsatzkopf wird neu geholt: sein 403 führt den Rahmen in die vorhandene Sackgasse.
    await waitFor(() => {
      const calls = spy.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey);
      expect(calls).toContainEqual(['einsatz', 1]);
    });
    expect(setTimeoutSpy.mock.calls.some(([, d]) => d === 1000)).toBe(false);
    expect(FakeEventSource.instanzen).toHaveLength(1);
    expect(quelle?.closed).toBe(true);
    expect(status[status.length - 1]).toBe('idle');
    expect(authVerloren).not.toHaveBeenCalled();
    window.removeEventListener(SITZUNG_ABGELAUFEN, authVerloren);
    window.removeEventListener('lfh:live-status', onStatus);
    setTimeoutSpy.mockRestore();
  });

  it('verbindet nach einem Endzustand neu, sobald der Einsatzkopf wieder lädt (Wiedergewähren, LFH-910)', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json({ id: 1 }, { status: 200 })),
      http.get('/api/einsaetze/1', () =>
        HttpResponse.json({ error: 'Kein Zugriff' }, { status: 403 }),
      ),
    );
    const status: string[] = [];
    const onStatus = (e: Event) =>
      status.push((e as CustomEvent<{ status: string }>).detail.status);
    window.addEventListener('lfh:live-status', onStatus);
    const client = neuerQueryClient();
    const spy = vi.spyOn(client, 'invalidateQueries');
    const { unmount } = render(
      <QueryClientProvider client={client}>
        <Probe id={1} />
      </QueryClientProvider>,
    );
    FakeEventSource.letzte?.emitError(FakeEventSource.CLOSED);
    await waitFor(() => {
      const calls = spy.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey);
      expect(calls).toContainEqual(['einsatz', 1]);
    });
    expect(FakeEventSource.instanzen).toHaveLength(1);

    // Ein von Hand gesetzter Kopf belegt keinen Zugriff, ein anderer Key und ein anderer
    // Einsatz auch nicht.
    client.setQueryData(['einsatz', 1], { id: 1 });
    await client.fetchQuery({ queryKey: ['einsatz-material', 1], queryFn: () => [] });
    await client.fetchQuery({ queryKey: ['einsatz', 2], queryFn: () => ({ id: 2 }) });
    expect(FakeEventSource.instanzen).toHaveLength(1);

    // „Wiederholen" in der Sackgasse lädt den Kopf jetzt erfolgreich: Zugriff wieder gewährt.
    await client.fetchQuery({ queryKey: ['einsatz', 1], queryFn: () => ({ id: 1 }) });
    expect(FakeEventSource.instanzen).toHaveLength(2);
    const neue = FakeEventSource.letzte!;
    expect(neue.url).toBe('/api/einsaetze/1/live');
    // Verpasste Ereignisse: der Erst-Open der neuen Verbindung gleicht voll ab.
    spy.mockClear();
    neue.emit('open');
    expect(status[status.length - 1]).toBe('open');
    await waitFor(() => {
      expect(spy).toHaveBeenCalledWith(...abgleich(['einsatz-material', 1]));
      expect(spy).toHaveBeenCalledWith(...abgleich(['einsaetze']));
    });

    // Ein weiterer Erfolg baut keine zweite Verbindung daneben.
    await client.fetchQuery({ queryKey: ['einsatz', 1], queryFn: () => ({ id: 1 }), staleTime: 0 });
    expect(FakeEventSource.instanzen).toHaveLength(2);

    unmount();
    expect(neue.closed).toBe(true);
    expect(status[status.length - 1]).toBe('idle');
    window.removeEventListener('lfh:live-status', onStatus);
  });

  it('baut bei gesunder Verbindung auf einen geladenen Einsatzkopf keine zweite auf (LFH-910)', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const client = neuerQueryClient();
    render(
      <QueryClientProvider client={client}>
        <Probe id={1} />
      </QueryClientProvider>,
    );
    FakeEventSource.letzte!.emit('open');
    await client.fetchQuery({ queryKey: ['einsatz', 1], queryFn: () => ({ id: 1 }) });
    expect(FakeEventSource.instanzen).toHaveLength(1);
    expect(FakeEventSource.letzte!.closed).toBe(false);
  });

  it('nimmt nach dem Unmount im Endzustand keinen Neustart mehr vor (LFH-910)', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json({ id: 1 }, { status: 200 })),
      http.get('/api/einsaetze/1', () =>
        HttpResponse.json({ error: 'Kein Zugriff' }, { status: 403 }),
      ),
    );
    const client = neuerQueryClient();
    const spy = vi.spyOn(client, 'invalidateQueries');
    const { unmount } = render(
      <QueryClientProvider client={client}>
        <Probe id={1} />
      </QueryClientProvider>,
    );
    FakeEventSource.letzte?.emitError(FakeEventSource.CLOSED);
    await waitFor(() => {
      const calls = spy.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey);
      expect(calls).toContainEqual(['einsatz', 1]);
    });
    unmount();
    await client.fetchQuery({ queryKey: ['einsatz', 1], queryFn: () => ({ id: 1 }) });
    expect(FakeEventSource.instanzen).toHaveLength(1);
  });

  it('baut nach dem Backoff neu auf, steigert ihn und setzt ihn nach open zurück (F14)', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    vi.spyOn(Math, 'random').mockReturnValue(0);
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json({ id: 1 }, { status: 200 })),
      http.get('/api/einsaetze/4', () => HttpResponse.json({ id: 4 }, { status: 200 })),
    );
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const client = neuerQueryClient();
    const spy = vi.spyOn(client, 'invalidateQueries');
    render(
      <QueryClientProvider client={client}>
        <Probe id={4} />
      </QueryClientProvider>,
    );
    const erste = FakeEventSource.letzte!;
    erste.emit('open');

    /** Löst einen CLOSED-Fehler aus, wartet auf den Backoff-Timer und feuert ihn sofort. */
    const fehlerUndBackoff = async (quelle: FakeEventSource, erwartet: number) => {
      setTimeoutSpy.mockClear();
      const vorher = FakeEventSource.instanzen.length;
      quelle.emitError(FakeEventSource.CLOSED);
      await waitFor(() =>
        expect(setTimeoutSpy.mock.calls.some(([, d]) => d === erwartet)).toBe(true),
      );
      const [cb] = setTimeoutSpy.mock.calls.find(([, d]) => d === erwartet)!;
      (cb as () => void)();
      expect(FakeEventSource.instanzen.length).toBe(vorher + 1);
      return FakeEventSource.letzte!;
    };

    const zweite = await fehlerUndBackoff(erste, 1000);
    expect(zweite.url).toBe('/api/einsaetze/4/live');
    const dritte = await fehlerUndBackoff(zweite, 3000);
    spy.mockClear();
    dritte.emit('open');
    // Neue Verbindung → Vollabgleich
    await waitFor(() => expect(spy).toHaveBeenCalledWith(...abgleich(['einsatz-material', 4])));
    await fehlerUndBackoff(dritte, 1000); // nach open wieder ab der ersten Stufe
    setTimeoutSpy.mockRestore();
  });

  it('streut den manuellen Neuaufbau um bis zu 50 Prozent (LFH-922)', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json({ id: 4 }, { status: 200 })),
      http.get('/api/einsaetze/4', () => HttpResponse.json({ id: 4 }, { status: 200 })),
    );
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    render(
      <QueryClientProvider client={neuerQueryClient()}>
        <Probe id={4} />
      </QueryClientProvider>,
    );
    FakeEventSource.letzte!.emitError(FakeEventSource.CLOSED);
    // 1000 ms Grundwert, Aufschlag 0,5 × 50 % = 25 %.
    await waitFor(() => expect(setTimeoutSpy.mock.calls.some(([, d]) => d === 1250)).toBe(true));
    expect(setTimeoutSpy.mock.calls.some(([, d]) => d === 1000)).toBe(false);
  });

  // LFH-734: der Einsatz-Strom trägt die Org-Ereignisse mit. Literale, nicht die Registry.
  it('invalidiert bei einsatzliste die Einsatzliste und die Admin-Listen (LFH-734)', () => {
    vi.useFakeTimers();
    vi.stubGlobal('EventSource', FakeEventSource);
    const client = neuerQueryClient();
    const spy = vi.spyOn(client, 'invalidateQueries');
    render(
      <QueryClientProvider client={client}>
        <Probe id={7} />
      </QueryClientProvider>,
    );
    FakeEventSource.letzte?.emit('einsatzliste', '{}');
    vi.advanceTimersByTime(LIVE_SAMMELFENSTER_MS);
    expect(spy).toHaveBeenCalledWith(...abgleich(['einsaetze']));
    expect(spy).toHaveBeenCalledWith(...abgleich(['demo-daten']));
    expect(spy).toHaveBeenCalledWith(...abgleich(['aufbewahrung']));
    expect(keysVon(spy)).not.toContainEqual(['einsatz', 7]);
  });

  it('invalidiert bei stammdaten die Kataloge samt Filter-Fächern (LFH-734)', () => {
    vi.useFakeTimers();
    vi.stubGlobal('EventSource', FakeEventSource);
    const client = new QueryClient();
    client.setQueryData(['personal', 'alle'], []);
    client.setQueryData(['fahrzeuge', 'im-dienst'], []);
    client.setQueryData(['einsatz-personal', 7], []);
    render(
      <QueryClientProvider client={client}>
        <Probe id={7} />
      </QueryClientProvider>,
    );
    FakeEventSource.letzte?.emit('stammdaten', '{}');
    vi.advanceTimersByTime(LIVE_SAMMELFENSTER_MS);
    expect(client.getQueryState(['personal', 'alle'])?.isInvalidated).toBe(true);
    expect(client.getQueryState(['fahrzeuge', 'im-dienst'])?.isInvalidated).toBe(true);
    expect(client.getQueryState(['einsatz-personal', 7])?.isInvalidated).toBe(false);
  });

  it('nimmt die Org-Keys in lagged und Wiederaufbau auf (LFH-734)', () => {
    vi.useFakeTimers();
    vi.stubGlobal('EventSource', FakeEventSource);
    const client = neuerQueryClient();
    const spy = vi.spyOn(client, 'invalidateQueries');
    render(
      <QueryClientProvider client={client}>
        <Probe id={7} />
      </QueryClientProvider>,
    );
    const quelle = FakeEventSource.letzte!;
    quelle.emit('lagged');
    vi.advanceTimersByTime(LIVE_SAMMELFENSTER_MS);
    expect(spy).toHaveBeenCalledWith(...abgleich(['einsaetze']));
    expect(spy).toHaveBeenCalledWith(...abgleich(['fahrzeuge']));
    quelle.emit('open'); // Erst-Open
    vi.advanceTimersByTime(LIVE_SAMMELFENSTER_MS);
    spy.mockClear();
    quelle.emit('open');
    vi.advanceTimersByTime(LIVE_SAMMELFENSTER_MS);
    expect(spy).toHaveBeenCalledWith(...abgleich(['einsaetze']));
    expect(spy).toHaveBeenCalledWith(...abgleich(['organisation']));
  });

  it('markiert beim Unmount Vorgemerktes nur, statt nach dem Abbau abzurufen (LFH-922)', () => {
    vi.useFakeTimers();
    vi.stubGlobal('EventSource', FakeEventSource);
    const client = neuerQueryClient();
    const spy = vi.spyOn(client, 'invalidateQueries');
    const { unmount } = render(
      <QueryClientProvider client={client}>
        <Probe id={7} />
      </QueryClientProvider>,
    );
    FakeEventSource.letzte!.emit('etb');
    unmount();
    expect(spy).toHaveBeenCalledWith(...abgleich(['etb', 7], 'none'));
    vi.advanceTimersByTime(LIVE_SAMMELFENSTER_MS);
    expect(spy).not.toHaveBeenCalledWith(...abgleich(['etb', 7]));
  });
});
