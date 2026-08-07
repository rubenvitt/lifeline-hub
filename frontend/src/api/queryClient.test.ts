import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, NetzFehler } from './client';
import { erzeugeQueryClient } from './queryClient';
import { SITZUNG_ABGELAUFEN, sitzungsMeldungZuruecksetzen } from '../auth/sitzungsEvent';

afterEach(() => sitzungsMeldungZuruecksetzen());

/** Führt eine Mutation aus, die mit `fehler` scheitert, und wartet ihr Ende ab. */
async function mutationScheitert(fehler: unknown) {
  const client = erzeugeQueryClient({ mutations: { retry: false } });
  await client
    .getMutationCache()
    .build(client, { mutationFn: () => Promise.reject(fehler) })
    .execute(undefined)
    .catch(() => {});
}

/** Führt eine Query aus, die mit `fehler` scheitert, und wartet ihr Ende ab. */
async function queryScheitert(fehler: unknown) {
  const client = erzeugeQueryClient({ queries: { retry: false } });
  await client
    .fetchQuery({ queryKey: ['test-401'], queryFn: () => Promise.reject(fehler) })
    .catch(() => {});
}

describe('erzeugeQueryClient — globale 401-Erkennung', () => {
  it('meldet den Sitzungsablauf, wenn eine Mutation 401 liefert', async () => {
    const horcher = vi.fn();
    window.addEventListener(SITZUNG_ABGELAUFEN, horcher);
    await mutationScheitert(new ApiError(401, 'Nicht angemeldet'));
    window.removeEventListener(SITZUNG_ABGELAUFEN, horcher);
    expect(horcher).toHaveBeenCalledTimes(1);
  });

  it('meldet den Sitzungsablauf, wenn eine Query 401 liefert', async () => {
    const horcher = vi.fn();
    window.addEventListener(SITZUNG_ABGELAUFEN, horcher);
    await queryScheitert(new ApiError(401, 'Nicht angemeldet'));
    window.removeEventListener(SITZUNG_ABGELAUFEN, horcher);
    expect(horcher).toHaveBeenCalledTimes(1);
  });

  it('schweigt bei jedem anderen ApiError — die lokalen onError-Handler melden ihn', async () => {
    const horcher = vi.fn();
    const konsole = vi.spyOn(console, 'error').mockImplementation(() => {});
    window.addEventListener(SITZUNG_ABGELAUFEN, horcher);
    await mutationScheitert(new ApiError(422, 'Ort darf nicht leer sein'));
    await mutationScheitert(new ApiError(409, 'Stornierter Schaden'));
    await queryScheitert(new ApiError(500, 'kaputt'));
    window.removeEventListener(SITZUNG_ABGELAUFEN, horcher);
    expect(horcher).not.toHaveBeenCalled();
    expect(konsole).not.toHaveBeenCalled();
    konsole.mockRestore();
  });

  it('protokolliert unerwartete Nicht-ApiError-Fehler, meldet aber keinen Sitzungsablauf', async () => {
    const horcher = vi.fn();
    const konsole = vi.spyOn(console, 'error').mockImplementation(() => {});
    window.addEventListener(SITZUNG_ABGELAUFEN, horcher);
    await mutationScheitert(new TypeError('Failed to fetch'));
    window.removeEventListener(SITZUNG_ABGELAUFEN, horcher);
    expect(horcher).not.toHaveBeenCalled();
    expect(konsole).toHaveBeenCalledTimes(1);
    konsole.mockRestore();
  });

  it('behandelt einen klassifizierten NetzFehler als erwarteten Betriebszustand', async () => {
    const konsole = vi.spyOn(console, 'error').mockImplementation(() => {});
    await mutationScheitert(new NetzFehler());
    expect(konsole).not.toHaveBeenCalled();
    konsole.mockRestore();
  });

  it('übernimmt die übergebenen defaultOptions', () => {
    const client = erzeugeQueryClient({ queries: { retry: false, gcTime: 0 } });
    expect(client.getDefaultOptions().queries?.gcTime).toBe(0);
  });
});

describe('erzeugeQueryClient — Produktionsdefaults', () => {
  it('wiederholt ausschließlich NetzFehler bei Queries höchstens zweimal mit Backoff', () => {
    const optionen = erzeugeQueryClient().getDefaultOptions().queries;
    const retry = optionen?.retry;
    const retryDelay = optionen?.retryDelay;

    expect(typeof retry).toBe('function');
    expect(typeof retryDelay).toBe('function');
    if (typeof retry !== 'function' || typeof retryDelay !== 'function') {
      throw new Error('Query-Retry-Defaults fehlen');
    }

    expect(retry(0, new NetzFehler())).toBe(true);
    expect(retry(1, new NetzFehler())).toBe(true);
    expect(retry(2, new NetzFehler())).toBe(false);
    expect(retry(0, new ApiError(503, 'nicht verfügbar'))).toBe(false);
    expect(retry(0, new TypeError('Programmierfehler'))).toBe(false);
    expect(retryDelay(0, new NetzFehler())).toBe(1_000);
    expect(retryDelay(1, new NetzFehler())).toBe(2_000);
  });

  it('wiederholt Mutationen nie automatisch', () => {
    expect(erzeugeQueryClient().getDefaultOptions().mutations?.retry).toBe(0);
  });
});
