import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './client';
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

  it('übernimmt die übergebenen defaultOptions', () => {
    const client = erzeugeQueryClient({ queries: { retry: false, gcTime: 0 } });
    expect(client.getDefaultOptions().queries?.gcTime).toBe(0);
  });
});
