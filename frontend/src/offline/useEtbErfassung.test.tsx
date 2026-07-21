import { http, HttpResponse } from 'msw';
import { renderHook, waitFor } from '@testing-library/react';
import { act } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { server } from '../test/server';
import { neuerQueryClient } from '../test/utils';
import type { NeuerEintrag } from '../api/etb';
import { queueEinreihen, queueLeerenFuerTests } from './queue';
import { SITZUNG_ABGELAUFEN, sitzungsMeldungZuruecksetzen } from '../auth/sitzungsEvent';
import { useEtbErfassung } from './useEtbErfassung';

const eintrag: NeuerEintrag = { typ: 'meldung', inhalt: 'x', erfasst_lokal_at: '2026-05-23T10:00:00Z' };

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={neuerQueryClient()}>{children}</QueryClientProvider>;
}

beforeEach(async () => {
  await queueLeerenFuerTests();
});

describe('useEtbErfassung', () => {
  it('reiht bei Netzwerkfehler ein und sendet beim Flush nach', async () => {
    let versuch = 0;
    server.use(
      http.post('/api/einsaetze/9/etb', () => {
        versuch += 1;
        return versuch === 1
          ? HttpResponse.error()
          : HttpResponse.json({ id: 1, lfd_nr: 1 }, { status: 201 });
      }),
    );

    const { result } = renderHook(() => useEtbErfassung(9), { wrapper });

    await act(async () => {
      await result.current.erfassen(eintrag);
    });
    await waitFor(() => expect(result.current.ausstehend).toHaveLength(1));

    await act(async () => {
      await result.current.flush();
    });
    await waitFor(() => expect(result.current.ausstehend).toHaveLength(0));
    expect(versuch).toBe(2);
  });

  it('reicht fachliche Ablehnung (ApiError) an den Aufrufer durch', async () => {
    server.use(
      http.post('/api/einsaetze/9/etb', () =>
        HttpResponse.json({ error: 'Keine Berechtigung' }, { status: 403 }),
      ),
    );
    const { result } = renderHook(() => useEtbErfassung(9), { wrapper });
    await expect(result.current.erfassen(eintrag)).rejects.toMatchObject({ status: 403 });
    expect(result.current.ausstehend).toHaveLength(0);
  });

  it('verwirft beim Flush abgelehnte Einträge nicht still, sondern meldet sie', async () => {
    server.use(http.post('/api/einsaetze/9/etb', () => HttpResponse.error()));

    const { result } = renderHook(() => useEtbErfassung(9), { wrapper });

    await act(async () => {
      await result.current.erfassen(eintrag);
    });
    await waitFor(() => expect(result.current.ausstehend).toHaveLength(1));

    server.use(
      http.post('/api/einsaetze/9/etb', () =>
        HttpResponse.json({ error: 'Keine Berechtigung' }, { status: 403 }),
      ),
    );

    await act(async () => {
      await result.current.flush();
    });

    await waitFor(() => expect(result.current.ausstehend).toHaveLength(0));
    await waitFor(() => expect(result.current.abgelehnt).toHaveLength(1));
    expect(result.current.abgelehnt[0]).toMatchObject({
      eintrag: { inhalt: 'x' },
      grund: 'Keine Berechtigung',
    });
  });

  it('sendet online und beim Flush dieselbe client_id (F03: kein Duplikat bei Timeout-nach-Commit)', async () => {
    const gesehen: (string | undefined)[] = [];
    let versuch = 0;
    server.use(
      http.post('/api/einsaetze/9/etb', async ({ request }) => {
        const body = (await request.json()) as NeuerEintrag;
        gesehen.push(body.client_id);
        versuch += 1;
        return versuch === 1
          ? HttpResponse.error()
          : HttpResponse.json({ id: 1, lfd_nr: 1 }, { status: 201 });
      }),
    );

    const { result } = renderHook(() => useEtbErfassung(9), { wrapper });
    await act(async () => {
      await result.current.erfassen(eintrag);
    });
    await waitFor(() => expect(result.current.ausstehend).toHaveLength(1));
    await act(async () => {
      await result.current.flush();
    });
    await waitFor(() => expect(result.current.ausstehend).toHaveLength(0));

    expect(gesehen).toHaveLength(2);
    expect(gesehen[0]).toBeTruthy();
    expect(gesehen[0]).toBe(gesehen[1]);
  });

  it('behält 401-Einträge in der Queue und signalisiert Re-Login (F03)', async () => {
    server.use(http.post('/api/einsaetze/9/etb', () => HttpResponse.error()));
    const { result } = renderHook(() => useEtbErfassung(9), { wrapper });
    await act(async () => {
      await result.current.erfassen(eintrag);
    });
    await waitFor(() => expect(result.current.ausstehend).toHaveLength(1));

    server.use(
      http.post('/api/einsaetze/9/etb', () =>
        HttpResponse.json({ error: 'Session abgelaufen' }, { status: 401 }),
      ),
    );
    // Das Signal geht an die zentrale Sitzungswache (LFH-268) — vorher setzte der Hook nur
    // einen `reLoginNoetig`-State, den kein Aufrufer las: der Nutzer sah nichts, und die
    // Queue lief in einen 30s-Endlos-Retry.
    const horcher = vi.fn();
    window.addEventListener(SITZUNG_ABGELAUFEN, horcher);
    await act(async () => {
      await result.current.flush();
    });

    await waitFor(() => expect(horcher).toHaveBeenCalledTimes(1));
    window.removeEventListener(SITZUNG_ABGELAUFEN, horcher);
    // Beweissicherndes Tagebuch: die Einträge bleiben, sie gehen nach dem Anmelden raus.
    expect(result.current.ausstehend).toHaveLength(1);
    expect(result.current.abgelehnt).toHaveLength(0);
  });

  it('behält 5xx-Einträge in der Queue (Serverfehler ist transient, F03)', async () => {
    server.use(http.post('/api/einsaetze/9/etb', () => HttpResponse.error()));
    const { result } = renderHook(() => useEtbErfassung(9), { wrapper });
    await act(async () => {
      await result.current.erfassen(eintrag);
    });
    await waitFor(() => expect(result.current.ausstehend).toHaveLength(1));

    server.use(
      http.post('/api/einsaetze/9/etb', () =>
        HttpResponse.json({ error: 'DB busy' }, { status: 503 }),
      ),
    );
    await act(async () => {
      await result.current.flush();
    });

    expect(result.current.ausstehend).toHaveLength(1);
    expect(result.current.abgelehnt).toHaveLength(0);
  });

  it('verschiebt 422-Ablehnungen persistent nach abgelehnt (überlebt Remount, F03)', async () => {
    server.use(http.post('/api/einsaetze/9/etb', () => HttpResponse.error()));
    const { result, unmount } = renderHook(() => useEtbErfassung(9), { wrapper });
    await act(async () => {
      await result.current.erfassen(eintrag);
    });
    await waitFor(() => expect(result.current.ausstehend).toHaveLength(1));

    server.use(
      http.post('/api/einsaetze/9/etb', () =>
        HttpResponse.json({ error: 'Ungültig' }, { status: 422 }),
      ),
    );
    await act(async () => {
      await result.current.flush();
    });
    await waitFor(() => expect(result.current.ausstehend).toHaveLength(0));
    await waitFor(() => expect(result.current.abgelehnt).toHaveLength(1));
    expect(result.current.abgelehnt[0]).toMatchObject({ grund: 'Ungültig', eintrag: { inhalt: 'x' } });

    // Reload: neuer Hook-Mount lädt abgelehnt aus IndexedDB (nicht flüchtig).
    unmount();
    const { result: result2 } = renderHook(() => useEtbErfassung(9), { wrapper });
    await waitFor(() => expect(result2.current.abgelehnt).toHaveLength(1));
  });

  it('verwirft einen abgelehnten Eintrag dauerhaft (Dismiss, F03)', async () => {
    server.use(http.post('/api/einsaetze/9/etb', () => HttpResponse.error()));
    const { result } = renderHook(() => useEtbErfassung(9), { wrapper });
    await act(async () => {
      await result.current.erfassen(eintrag);
    });
    await waitFor(() => expect(result.current.ausstehend).toHaveLength(1));

    server.use(
      http.post('/api/einsaetze/9/etb', () =>
        HttpResponse.json({ error: 'Ungültig' }, { status: 422 }),
      ),
    );
    await act(async () => {
      await result.current.flush();
    });
    await waitFor(() => expect(result.current.abgelehnt).toHaveLength(1));

    const id = result.current.abgelehnt[0].id!;
    await act(async () => {
      await result.current.abgelehntVerwerfen(id);
    });
    await waitFor(() => expect(result.current.abgelehnt).toHaveLength(0));
  });

  it('serialisiert den Flush über navigator.locks und setzt bei gehaltenem Lock aus (F03)', async () => {
    const request = vi.fn(
      async (_name: string, _opts: unknown, cb: (lock: unknown) => unknown) => cb(null),
    );
    Object.defineProperty(navigator, 'locks', { configurable: true, value: { request } });
    try {
      let posts = 0;
      server.use(
        http.post('/api/einsaetze/9/etb', () => {
          posts += 1;
          return HttpResponse.json({ id: 1, lfd_nr: 1 }, { status: 201 });
        }),
      );
      await queueEinreihen(9, eintrag);
      const { result } = renderHook(() => useEtbErfassung(9), { wrapper });
      await waitFor(() => expect(result.current.ausstehend).toHaveLength(1));
      await act(async () => {
        await result.current.flush();
      });

      expect(request).toHaveBeenCalledWith(
        'etb-flush-9',
        expect.objectContaining({ ifAvailable: true }),
        expect.any(Function),
      );
      expect(posts).toBe(0); // Lock von anderem Tab gehalten → kein Sendeversuch
      expect(result.current.ausstehend).toHaveLength(1);
    } finally {
      delete (navigator as { locks?: unknown }).locks;
    }
  });

  it('plant nach transientem Fehler einen Backoff-Retry (F03)', async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    try {
      server.use(http.post('/api/einsaetze/9/etb', () => HttpResponse.error()));
      const { result } = renderHook(() => useEtbErfassung(9), { wrapper });
      await act(async () => {
        await result.current.erfassen(eintrag);
      });
      await waitFor(() => expect(result.current.ausstehend).toHaveLength(1));

      setTimeoutSpy.mockClear();
      server.use(
        http.post('/api/einsaetze/9/etb', () =>
          HttpResponse.json({ error: 'busy' }, { status: 503 }),
        ),
      );
      await act(async () => {
        await result.current.flush();
      });

      // Transienter 503 → Eintrag bleibt UND ein Backoff-Retry (erste Stufe 1000ms) ist geplant.
      expect(result.current.ausstehend).toHaveLength(1);
      expect(setTimeoutSpy.mock.calls.some(([, delay]) => delay === 1000)).toBe(true);
    } finally {
      setTimeoutSpy.mockRestore();
    }
  });

  it.each([408, 429])('behält %i-Einträge in der Queue (transient, F03)', async (code) => {
    server.use(http.post('/api/einsaetze/9/etb', () => HttpResponse.error()));
    const { result } = renderHook(() => useEtbErfassung(9), { wrapper });
    await act(async () => {
      await result.current.erfassen(eintrag);
    });
    await waitFor(() => expect(result.current.ausstehend).toHaveLength(1));

    server.use(
      http.post('/api/einsaetze/9/etb', () =>
        HttpResponse.json({ error: 'transient' }, { status: code }),
      ),
    );
    await act(async () => {
      await result.current.flush();
    });

    expect(result.current.ausstehend).toHaveLength(1);
    expect(result.current.abgelehnt).toHaveLength(0);
  });

  it('eskaliert den Backoff über die Stufen und resettet nach Erfolg (F03)', async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    try {
      // Antwort-Umschalter: 999 = Netzfehler (enqueue ohne Backoff), 503 = transient, 201 = ok.
      let code = 999;
      server.use(
        http.post('/api/einsaetze/9/etb', () => {
          if (code === 999) return HttpResponse.error();
          if (code === 201) return HttpResponse.json({ id: 1, lfd_nr: 1 }, { status: 201 });
          return HttpResponse.json({ error: 'busy' }, { status: code });
        }),
      );
      const { result } = renderHook(() => useEtbErfassung(9), { wrapper });
      await act(async () => {
        await result.current.erfassen(eintrag); // Netzfehler → enqueue, backoffStufe bleibt 0
      });
      await waitFor(() => expect(result.current.ausstehend).toHaveLength(1));

      const stufen = () =>
        setTimeoutSpy.mock.calls
          .map((c) => c[1])
          .filter((d) => [1000, 5000, 15000, 30000].includes(d as number));

      code = 503;
      setTimeoutSpy.mockClear();
      await act(async () => {
        await result.current.flush(); // Stufe 0 → 1000
      });
      await act(async () => {
        await result.current.flush(); // Stufe 1 → 5000
      });
      await act(async () => {
        await result.current.flush(); // Stufe 2 → 15000
      });
      expect(stufen()).toEqual([1000, 5000, 15000]);

      // Erfolgreicher Flush → Queue leer + backoffStufe-Reset.
      code = 201;
      await act(async () => {
        await result.current.flush();
      });
      await waitFor(() => expect(result.current.ausstehend).toHaveLength(0));

      // Neuer transienter Fehler → wieder bei Stufe 0 (1000).
      code = 999;
      await act(async () => {
        await result.current.erfassen(eintrag);
      });
      await waitFor(() => expect(result.current.ausstehend).toHaveLength(1));
      code = 503;
      setTimeoutSpy.mockClear();
      await act(async () => {
        await result.current.flush();
      });
      expect(stufen()).toEqual([1000]);
    } finally {
      setTimeoutSpy.mockRestore();
    }
  });
});

afterEach(() => {
  delete (navigator as { locks?: unknown }).locks;
  // Die Melde-Sperre ist modulweit — ohne Reset bliebe ein zweiter 401-Test stumm (LFH-268).
  sitzungsMeldungZuruecksetzen();
});
