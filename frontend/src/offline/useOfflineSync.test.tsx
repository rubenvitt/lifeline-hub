import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, NetzFehler } from '../api/client';
import { erfasseEtb } from '../api/etb';
import { legePersonAn } from '../api/einsatzPerson';
import { legeMeldungAn } from '../api/meldungen';
import { einsatzKeys } from '../api/queryKeys';
import type { Person } from '../api/types';
import {
  SITZUNG_ABGELAUFEN,
  sitzungsMeldungZuruecksetzen,
} from '../auth/sitzungsEvent';
import {
  OFFLINE_SCHREIBAKTION_GESENDET_EVENT,
  type OfflineSchreibaktionGesendet,
} from './ereignisse';
import {
  queueEinreihen,
  queueLeerenFuerTests,
  queueZaehlerLaden,
  schreibaktionEinreihen,
} from './queue';
import { useOfflineSync } from './useOfflineSync';

vi.mock('../api/etb', () => ({ erfasseEtb: vi.fn() }));
vi.mock('../api/einsatzPerson', () => ({ legePersonAn: vi.fn() }));
vi.mock('../api/meldungen', () => ({ legeMeldungAn: vi.fn() }));

const BENUTZER_A = 11;
const BENUTZER_B = 22;

function neuerClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function wrapperFuer(client = neuerClient()) {
  const Wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, Wrapper };
}

function online(wert: boolean): void {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: wert });
}

function ohneWebLocks(): void {
  Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
}

beforeEach(async () => {
  vi.clearAllMocks();
  online(true);
  ohneWebLocks();
  vi.mocked(erfasseEtb).mockResolvedValue({} as Awaited<ReturnType<typeof erfasseEtb>>);
  vi.mocked(legePersonAn).mockResolvedValue({ id: 1 } as Person);
  vi.mocked(legeMeldungAn).mockResolvedValue({} as Awaited<ReturnType<typeof legeMeldungAn>>);
  await queueLeerenFuerTests();
});

describe('globaler benutzergebundener Offline-Flush (LFH-334)', () => {
  it('sendet ETB, Person und Meldung ohne geöffnete Fachseite', async () => {
    await queueEinreihen(BENUTZER_A, 7, {
      typ: 'meldung', inhalt: 'ETB', client_id: 'etb-1',
    });
    await schreibaktionEinreihen(BENUTZER_A, 7, {
      art: 'person', daten: { status: 'vermisst', client_id: 'person-1' },
    });
    await schreibaktionEinreihen(BENUTZER_A, 7, {
      art: 'meldung',
      daten: {
        absender: 'ELW', meldeweg: 'funk', inhalt: 'Lage',
        ereigniszeit: '2026-08-06 12:00:00', client_id: 'meldung-1',
      },
    });

    renderHook(() => useOfflineSync(BENUTZER_A), { wrapper: wrapperFuer().Wrapper });
    await waitFor(async () => expect(await queueZaehlerLaden(BENUTZER_A, 7)).toEqual({
      ausstehend: 0, abgelehnt: 0, nicht_zugeordnet: 0,
    }));
    expect(erfasseEtb).toHaveBeenCalledOnce();
    expect(legePersonAn).toHaveBeenCalledOnce();
    expect(legeMeldungAn).toHaveBeenCalledOnce();
    expect(erfasseEtb).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ client_id: 'etb-1' }),
      { offlineQueueBenutzerId: BENUTZER_A },
    );
    expect(legePersonAn).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ client_id: 'person-1' }),
      { offlineQueueBenutzerId: BENUTZER_A },
    );
    expect(legeMeldungAn).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ client_id: 'meldung-1' }),
      { offlineQueueBenutzerId: BENUTZER_A },
    );
  });

  it('macht fachliche Ablehnung sichtbar statt endlos zu wiederholen', async () => {
    vi.mocked(legePersonAn).mockRejectedValue(new ApiError(422, 'Status unzulässig'));
    await schreibaktionEinreihen(BENUTZER_A, 7, {
      art: 'person', daten: { client_id: 'person-2' },
    });
    renderHook(() => useOfflineSync(BENUTZER_A), { wrapper: wrapperFuer().Wrapper });
    await waitFor(async () => expect(await queueZaehlerLaden(BENUTZER_A, 7)).toEqual({
      ausstehend: 0, abgelehnt: 1, nicht_zugeordnet: 0,
    }));
    expect(legePersonAn).toHaveBeenCalledOnce();
  });

  it('sendet nach einem Benutzerwechsel ausschließlich die neue Identität', async () => {
    online(false);
    await schreibaktionEinreihen(BENUTZER_A, 7, {
      art: 'person', daten: { name: 'A', client_id: 'person-a' },
    });
    await schreibaktionEinreihen(BENUTZER_B, 7, {
      art: 'person', daten: { name: 'B', client_id: 'person-b' },
    });
    const { Wrapper } = wrapperFuer();
    const { rerender } = renderHook(
      ({ benutzerId }) => useOfflineSync(benutzerId),
      { wrapper: Wrapper, initialProps: { benutzerId: BENUTZER_A } },
    );

    rerender({ benutzerId: BENUTZER_B });
    online(true);
    window.dispatchEvent(new Event('online'));

    await waitFor(async () => expect(await queueZaehlerLaden(BENUTZER_B, 7)).toMatchObject({
      ausstehend: 0,
    }));
    expect(await queueZaehlerLaden(BENUTZER_A, 7)).toMatchObject({ ausstehend: 1 });
    expect(legePersonAn).toHaveBeenCalledTimes(1);
    expect(legePersonAn).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ name: 'B' }),
      { offlineQueueBenutzerId: BENUTZER_B },
    );
  });

  it('holt einen während des Flushs eingereihten Datensatz im Dirty-Nachlauf ab', async () => {
    let erstenAufloesen!: (person: Person) => void;
    vi.mocked(legePersonAn)
      .mockImplementationOnce(() => new Promise((resolve) => { erstenAufloesen = resolve; }))
      .mockResolvedValueOnce({ id: 2 } as Person);
    await schreibaktionEinreihen(BENUTZER_A, 7, {
      art: 'person', daten: { name: 'Erste', client_id: 'person-1' },
    });
    renderHook(() => useOfflineSync(BENUTZER_A), { wrapper: wrapperFuer().Wrapper });
    await waitFor(() => expect(legePersonAn).toHaveBeenCalledOnce());

    await schreibaktionEinreihen(BENUTZER_A, 7, {
      art: 'person', daten: { name: 'Zweite', client_id: 'person-2' },
    });
    erstenAufloesen({ id: 1 } as Person);

    await waitFor(() => expect(legePersonAn).toHaveBeenCalledTimes(2));
    await waitFor(async () => expect(await queueZaehlerLaden(BENUTZER_A, 7)).toMatchObject({
      ausstehend: 0,
    }));
  });

  it('wartet auf Web Locks und liest die Queue erst nach Lock-Erhalt neu', async () => {
    let lockFreigeben!: () => void;
    const request = vi.fn((
      _name: string,
      callback: (lock: Lock) => Promise<boolean>,
    ) => new Promise<boolean>((resolve, reject) => {
      lockFreigeben = () => void callback({} as Lock).then(resolve, reject);
    }));
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: { request } as unknown as LockManager,
    });
    await schreibaktionEinreihen(BENUTZER_A, 7, {
      art: 'person', daten: { name: 'Vor Lock', client_id: 'person-lock-1' },
    });
    renderHook(() => useOfflineSync(BENUTZER_A), { wrapper: wrapperFuer().Wrapper });
    await waitFor(() => expect(request).toHaveBeenCalledOnce());
    expect(request.mock.calls[0]).toHaveLength(2);

    await schreibaktionEinreihen(BENUTZER_A, 7, {
      art: 'person', daten: { name: 'Im Lock-Warten', client_id: 'person-lock-2' },
    });
    lockFreigeben();

    await waitFor(() => expect(legePersonAn).toHaveBeenCalledTimes(2));
    await waitFor(async () => expect(await queueZaehlerLaden(BENUTZER_A, 7)).toMatchObject({
      ausstehend: 0,
    }));
    expect(request).toHaveBeenCalledOnce();
  });

  it('bearbeitet weitere Einsätze trotz transientem Fehler im ersten Einsatz', async () => {
    vi.mocked(legePersonAn).mockImplementation(async (einsatzId) => {
      if (einsatzId === 7) throw new NetzFehler();
      return { id: 8 } as Person;
    });
    await schreibaktionEinreihen(BENUTZER_A, 7, {
      art: 'person', daten: { client_id: 'transient' },
    });
    await schreibaktionEinreihen(BENUTZER_A, 8, {
      art: 'person', daten: { client_id: 'erfolgreich' },
    });
    const { unmount } = renderHook(() => useOfflineSync(BENUTZER_A), {
      wrapper: wrapperFuer().Wrapper,
    });

    await waitFor(() => expect(legePersonAn).toHaveBeenCalledWith(
      8,
      expect.objectContaining({ client_id: 'erfolgreich' }),
      { offlineQueueBenutzerId: BENUTZER_A },
    ));
    expect(await queueZaehlerLaden(BENUTZER_A, 7)).toMatchObject({ ausstehend: 1 });
    expect(await queueZaehlerLaden(BENUTZER_A, 8)).toMatchObject({ ausstehend: 0 });
    unmount();
  });

  it('behält eine stale Cross-Tab-Queue bei 412 transient, ohne die Sitzung abzumelden', async () => {
    vi.mocked(legePersonAn).mockRejectedValue(
      new ApiError(412, 'Offline-Queue gehört zu einem anderen Benutzer'),
    );
    await schreibaktionEinreihen(BENUTZER_A, 7, {
      art: 'person', daten: { name: 'Alter Tab', client_id: 'stale-tab-1' },
    });

    sitzungsMeldungZuruecksetzen();
    const sitzungsAblauf = vi.fn();
    window.addEventListener(SITZUNG_ABGELAUFEN, sitzungsAblauf);
    const { unmount } = renderHook(() => useOfflineSync(BENUTZER_A), {
      wrapper: wrapperFuer().Wrapper,
    });

    await waitFor(() => expect(legePersonAn).toHaveBeenCalledOnce());
    expect(legePersonAn).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ client_id: 'stale-tab-1' }),
      { offlineQueueBenutzerId: BENUTZER_A },
    );
    expect(await queueZaehlerLaden(BENUTZER_A, 7)).toEqual({
      ausstehend: 1,
      abgelehnt: 0,
      nicht_zugeordnet: 0,
    });
    expect(sitzungsAblauf).not.toHaveBeenCalled();
    window.removeEventListener(SITZUNG_ABGELAUFEN, sitzungsAblauf);
    unmount();
  });

  it('merged eine gesendete Person nur in vorhandenen Cache und meldet die client_id', async () => {
    const { client, Wrapper } = wrapperFuer();
    const vorhanden = { id: 41, registrier_nr: 40 } as Person;
    const gesendet = { id: 42, registrier_nr: 41 } as Person;
    client.setQueryData<Person[]>(einsatzKeys.personen(7), [vorhanden]);
    vi.mocked(legePersonAn).mockResolvedValue(gesendet);
    const ereignisse: OfflineSchreibaktionGesendet[] = [];
    const listener = (event: Event) => {
      ereignisse.push((event as CustomEvent<OfflineSchreibaktionGesendet>).detail);
    };
    window.addEventListener(OFFLINE_SCHREIBAKTION_GESENDET_EVENT, listener);
    await schreibaktionEinreihen(BENUTZER_A, 7, {
      art: 'person', daten: { client_id: 'korrelation-1' },
    });

    renderHook(() => useOfflineSync(BENUTZER_A), { wrapper: Wrapper });
    await waitFor(() => expect(ereignisse).toHaveLength(1));
    expect(client.getQueryData<Person[]>(einsatzKeys.personen(7)))
      .toEqual([vorhanden, gesendet]);
    expect(client.getQueryState(einsatzKeys.personen(7))?.isInvalidated).toBe(true);
    expect(ereignisse[0]).toMatchObject({
      art: 'person', benutzerId: BENUTZER_A, einsatzId: 7, clientId: 'korrelation-1',
      daten: gesendet,
    });
    window.removeEventListener(OFFLINE_SCHREIBAKTION_GESENDET_EVENT, listener);
  });

  it('erzeugt ohne bestehenden Personen-Cache keine unvollständige Singleton-Liste', async () => {
    const { client, Wrapper } = wrapperFuer();
    vi.mocked(legePersonAn).mockResolvedValue({ id: 42 } as Person);
    await schreibaktionEinreihen(BENUTZER_A, 7, {
      art: 'person', daten: { client_id: 'ohne-cache' },
    });
    renderHook(() => useOfflineSync(BENUTZER_A), { wrapper: Wrapper });

    await waitFor(() => expect(legePersonAn).toHaveBeenCalledOnce());
    expect(client.getQueryData(einsatzKeys.personen(7))).toBeUndefined();
  });
});
