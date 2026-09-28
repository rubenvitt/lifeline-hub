import { describe, expect, it, vi } from 'vitest';
import { QueryClient, dehydrate, hydrate } from '@tanstack/react-query';
import { einsatzKeys } from '../api/queryKeys';
import { fetchErfolgeVerfolgen } from './lagebildBestaetigung';

describe('fetchErfolgeVerfolgen (design.md D4)', () => {
  it('meldet einen Fetch-Erfolg mit seinem Key', async () => {
    const qc = new QueryClient();
    const erfolg = vi.fn();
    fetchErfolgeVerfolgen(qc, erfolg);
    await qc.fetchQuery({ queryKey: einsatzKeys.personen(7), queryFn: async () => [] });
    expect(erfolg).toHaveBeenCalledWith(einsatzKeys.personen(7));
  });

  it('meldet setQueryData NICHT — das ist keine Server-Antwort', () => {
    const qc = new QueryClient();
    const erfolg = vi.fn();
    fetchErfolgeVerfolgen(qc, erfolg);
    qc.setQueryData(einsatzKeys.personen(7), []);
    expect(erfolg).not.toHaveBeenCalled();
  });

  it('meldet hydrate NICHT — ein wiederhergestellter Stand bestätigt nichts', () => {
    const quelle = new QueryClient();
    quelle.setQueryData(einsatzKeys.personen(7), []);
    const qc = new QueryClient();
    const erfolg = vi.fn();
    fetchErfolgeVerfolgen(qc, erfolg);
    hydrate(qc, dehydrate(quelle));
    expect(erfolg).not.toHaveBeenCalled();
  });

  it('meldet einen Fehlschlag nicht und hört nach dem Abmelden auf', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const erfolg = vi.fn();
    const abmelden = fetchErfolgeVerfolgen(qc, erfolg);
    await qc
      .fetchQuery({ queryKey: ['x', 1], queryFn: () => Promise.reject(new Error('weg')) })
      .catch(() => {});
    expect(erfolg).not.toHaveBeenCalled();
    abmelden();
    await qc.fetchQuery({ queryKey: ['y', 1], queryFn: async () => 1 });
    expect(erfolg).not.toHaveBeenCalled();
  });
});
