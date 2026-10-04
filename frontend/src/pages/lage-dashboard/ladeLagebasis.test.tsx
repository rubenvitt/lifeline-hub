import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ladeEinsatz, ladeModulFreigaben } from '../../api/einsaetze';
import { listeAbschnitte } from '../../api/einsatzabschnitte';
import { listeEinsatzFahrzeuge } from '../../api/einsatzFahrzeuge';
import { listeEinsatzMaterial } from '../../api/einsatzMaterial';
import { listePersonen } from '../../api/einsatzPerson';
import { listeEinsatzPersonal } from '../../api/einsatzPersonal';
import { listeSchaeden } from '../../api/einsatzSchaden';
import { listeUhs } from '../../api/einsatzUhs';
import { listeEinheiten } from '../../api/einheiten';
import { ladeGefahrengebiete } from '../../api/gefahren';
import { listeLageberichte } from '../../api/lageberichte';
import { ladeModulZaehler } from '../../api/modulZaehler';
import { listePegel } from '../../api/pegel';
import type { ModulFreigaben } from '../../api/types';
import { freigabenFixture } from '../../test/fixtures';
import { LAGEBILD_QUELLEN, ladeLagebasis, useLagebild, type GebundeneQuelle } from './useLagebild';

vi.mock('../../api/einsaetze', () => ({ ladeEinsatz: vi.fn(), ladeModulFreigaben: vi.fn() }));
vi.mock('../../api/einsatzabschnitte', () => ({ listeAbschnitte: vi.fn() }));
vi.mock('../../api/einsatzFahrzeuge', () => ({ listeEinsatzFahrzeuge: vi.fn() }));
vi.mock('../../api/einsatzMaterial', () => ({ listeEinsatzMaterial: vi.fn() }));
vi.mock('../../api/einsatzPerson', () => ({ listePersonen: vi.fn() }));
vi.mock('../../api/einsatzPersonal', () => ({ listeEinsatzPersonal: vi.fn() }));
vi.mock('../../api/einsatzSchaden', () => ({ listeSchaeden: vi.fn() }));
vi.mock('../../api/einsatzUhs', () => ({ listeUhs: vi.fn() }));
vi.mock('../../api/einheiten', () => ({ listeEinheiten: vi.fn() }));
vi.mock('../../api/gefahren', () => ({ ladeGefahrengebiete: vi.fn() }));
vi.mock('../../api/lageberichte', () => ({ listeLageberichte: vi.fn() }));
vi.mock('../../api/modulZaehler', () => ({ ladeModulZaehler: vi.fn() }));
vi.mock('../../api/pegel', async () => {
  const { einsatzKeys } = await import('../../api/queryKeys');
  const listePegel = vi.fn();
  // `pegelAbfrage` ruft `listePegel` modulintern; ohne eigenen Ersatz ginge der Abruf ins Netz.
  return {
    listePegel,
    pegelAbfrage: (id: number) => ({
      queryKey: einsatzKeys.pegel(id),
      queryFn: () => listePegel(id),
    }),
  };
});

const EINSATZ = { id: 1, name: 'Hochwasser', lagekennzahlen: [] };
/** Je Liste ein erkennbarer Eintrag: so fällt eine vertauschte Liste im Vergleich auf. */
const LISTEN: Record<GebundeneQuelle, unknown[]> = {
  personen: [{ id: 1, status: 'vermisst' }],
  uhs: [{ id: 2 }],
  schaeden: [{ id: 3 }],
  gefahren: [{ id: 4 }],
  lageberichte: [{ id: 5 }],
  einheiten: [{ id: 6 }],
  personal: [{ id: 7 }],
  fahrzeuge: [{ id: 8 }],
  material: [{ id: 9 }],
  abschnitte: [{ id: 10 }],
};
const ABRUF: Record<GebundeneQuelle, ReturnType<typeof vi.fn>> = {
  personen: vi.mocked(listePersonen),
  uhs: vi.mocked(listeUhs),
  schaeden: vi.mocked(listeSchaeden),
  gefahren: vi.mocked(ladeGefahrengebiete),
  lageberichte: vi.mocked(listeLageberichte),
  einheiten: vi.mocked(listeEinheiten),
  personal: vi.mocked(listeEinsatzPersonal),
  fahrzeuge: vi.mocked(listeEinsatzFahrzeuge),
  material: vi.mocked(listeEinsatzMaterial),
  abschnitte: vi.mocked(listeAbschnitte),
};
const PEGEL = [{ id: 11 }];
const ALLE = Object.keys(LAGEBILD_QUELLEN) as GebundeneQuelle[];

function neuerClient(staleTime = 0) {
  return new QueryClient({ defaultOptions: { queries: { retry: false, staleTime } } });
}

function mitFreigaben(freigaben: ModulFreigaben) {
  vi.mocked(ladeModulFreigaben).mockResolvedValue(freigaben);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(ladeEinsatz).mockResolvedValue(EINSATZ as never);
  for (const q of ALLE) ABRUF[q].mockResolvedValue(LISTEN[q]);
  vi.mocked(listePegel).mockResolvedValue(PEGEL as never);
  vi.mocked(ladeModulZaehler).mockResolvedValue({} as never);
});

describe('ladeLagebasis (LFH-869 D1)', () => {
  it('liefert dieselbe Lagebasis wie useLagebild', async () => {
    const freigaben = freigabenFixture();
    mitFreigaben(freigaben);
    const qcHook = neuerClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qcHook}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useLagebild(1, { mitPegel: true }), { wrapper });
    await waitFor(() => {
      expect(Object.values(result.current.zustand).every((z) => z === 'daten')).toBe(true);
    });

    const geladen = await ladeLagebasis(neuerClient(), 1, freigaben, {
      quellen: ALLE,
      mitPegel: true,
    });

    expect(geladen.basis).toEqual(result.current.basis);
    for (const q of ALLE) expect(geladen.zustand[q]).toBe(result.current.zustand[q]);
    expect(geladen.zustand.pegel).toBe('daten');
  });

  it('fragt eine gesperrte Liste nicht an und meldet sie wie der Hook als gesperrt', async () => {
    const freigaben = freigabenFixture({ personen: { zugriff: false } });
    mitFreigaben(freigaben);
    const qcHook = neuerClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qcHook}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useLagebild(1, { mitPegel: false }), { wrapper });
    await waitFor(() => expect(result.current.zustand.schaeden).toBe('daten'));
    vi.mocked(listePersonen).mockClear();

    const geladen = await ladeLagebasis(neuerClient(), 1, freigaben, {
      quellen: ['personen', 'schaeden'],
      mitPegel: false,
    });

    expect(listePersonen).not.toHaveBeenCalled();
    expect(geladen.zustand.personen).toBe('gesperrt');
    expect(result.current.zustand.personen).toBe('gesperrt');
    expect(geladen.basis?.personen).toEqual([]);
    expect(geladen.basis?.schaeden).toEqual(LISTEN.schaeden);
  });

  it('lädt nur die genannten Listen', async () => {
    const geladen = await ladeLagebasis(neuerClient(), 1, freigabenFixture(), {
      quellen: ['gefahren'],
      mitPegel: false,
    });
    expect(ladeGefahrengebiete).toHaveBeenCalledTimes(1);
    for (const q of ALLE.filter((x) => x !== 'gefahren')) expect(ABRUF[q]).not.toHaveBeenCalled();
    expect(listePegel).not.toHaveBeenCalled();
    expect(geladen.zustand.personen).toBeUndefined();
  });

  it('nennt einen gescheiterten Abruf „fehler“, nie leere Daten mit „daten“', async () => {
    vi.mocked(listeSchaeden).mockRejectedValue(new Error('weg'));
    const geladen = await ladeLagebasis(neuerClient(), 1, freigabenFixture(), {
      quellen: ['schaeden'],
      mitPegel: false,
    });
    expect(geladen.zustand.schaeden).toBe('fehler');
  });

  it('der Stand ist der älteste Abruf der gelesenen Quellen', async () => {
    // Frisch genug für den Cache: `fetchQuery` liest ihn, statt neu zu laden.
    const qc = neuerClient(Infinity);
    const alt = Date.UTC(2026, 9, 4, 10, 0, 0);
    qc.setQueryData(LAGEBILD_QUELLEN.schaeden.key(1), LISTEN.schaeden, { updatedAt: alt });
    const geladen = await ladeLagebasis(qc, 1, freigabenFixture(), {
      quellen: ['schaeden', 'gefahren'],
      mitPegel: false,
    });
    expect(geladen.stand).toBe(alt);
  });
});
