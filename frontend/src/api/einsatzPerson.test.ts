import { afterEach, describe, expect, it, vi } from 'vitest';
import { ladePersonenDruck } from './einsatzPerson';

afterEach(() => vi.restoreAllMocks());

// LFH-727: Der Personendruck lädt über den protokollierenden Druck-Endpunkt, nie über die Liste.
describe('ladePersonenDruck', () => {
  it('ruft genau GET /api/einsaetze/{id}/personen/druck', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('[]', { status: 200 }));
    await expect(ladePersonenDruck(7)).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [pfad, init] = fetchMock.mock.calls[0];
    expect(pfad).toBe('/api/einsaetze/7/personen/druck');
    expect(init?.method ?? 'GET').toBe('GET');
  });
});
