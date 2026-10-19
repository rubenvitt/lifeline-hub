import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { meldeBelegung, meldeStand } from '../api/betreuung';
import { ApiError, AusgangUnbekannt, NetzFehler } from '../api/client';
import { bucheEintreffen } from '../api/einsatzBereitstellungsraum';
import { erfasseEtb } from '../api/etb';
import {
  createMassnahme,
  createVerletzung,
  erfasseSichtung,
  erfasseVerbleib,
  legeNotizAn,
  legePersonAn,
  saveTransport,
} from '../api/einsatzPerson';
import { legeMeldungAn } from '../api/meldungen';
import { einsatzKeys } from '../api/queryKeys';
import type { Person, Verpflegung, VerpflegungZeitfenster } from '../api/types';
import { erfasseAusgabe } from '../api/verpflegung';
import { SITZUNG_ABGELAUFEN, sitzungsMeldungZuruecksetzen } from '../auth/sitzungsEvent';
import { abgleichFuer } from './useOfflineSync';
import {
  OFFLINE_SCHREIBAKTION_GESENDET_EVENT,
  type OfflineSchreibaktionGesendet,
} from './ereignisse';
import {
  OFFLINE_QUEUE_EVENT,
  abgelehntLaden,
  abgelehntOhneAnhaengeWiederholen,
  queueEinreihen,
  queueLeerenFuerTests,
  queueZaehlerLaden,
  schreibaktionEinreihen,
  schreibaktionenAbgelehntLaden,
} from './queue';
import { useOfflineSync } from './useOfflineSync';
import { merkeVerpflegungsausgabeVor } from './schreiben';
import { useVorgemerkteAusgaben } from './useVorgemerkteAusgaben';
import { KEINE_SONDERKOST, ausgabe as serverAusgabe, zeitfenster } from '../test/verpflegungDaten';

vi.mock('../api/etb', () => ({ erfasseEtb: vi.fn() }));
vi.mock('../api/einsatzPerson', () => ({
  legePersonAn: vi.fn(),
  erfasseSichtung: vi.fn(),
  erfasseVerbleib: vi.fn(),
  legeNotizAn: vi.fn(),
  saveTransport: vi.fn(),
  createMassnahme: vi.fn(),
  createVerletzung: vi.fn(),
}));
vi.mock('../api/meldungen', () => ({ legeMeldungAn: vi.fn() }));
vi.mock('../api/betreuung', () => ({ meldeStand: vi.fn(), meldeBelegung: vi.fn() }));
vi.mock('../api/verpflegung', () => ({ erfasseAusgabe: vi.fn() }));
vi.mock('../api/einsatzBereitstellungsraum', () => ({ bucheEintreffen: vi.fn() }));

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
      typ: 'meldung',
      inhalt: 'ETB',
      client_id: 'etb-1',
    });
    await schreibaktionEinreihen(BENUTZER_A, 7, {
      art: 'person',
      daten: { status: 'vermisst', client_id: 'person-1' },
    });
    await schreibaktionEinreihen(BENUTZER_A, 7, {
      art: 'meldung',
      daten: {
        absender: 'ELW',
        meldeweg: 'funk',
        inhalt: 'Lage',
        ereigniszeit: '2026-08-06 12:00:00',
        client_id: 'meldung-1',
      },
    });

    renderHook(() => useOfflineSync(BENUTZER_A), { wrapper: wrapperFuer().Wrapper });
    await waitFor(async () =>
      expect(await queueZaehlerLaden(BENUTZER_A, 7)).toEqual({
        ausstehend: 0,
        abgelehnt: 0,
        nicht_zugeordnet: 0,
      }),
    );
    expect(erfasseEtb).toHaveBeenCalledOnce();
    expect(legePersonAn).toHaveBeenCalledOnce();
    expect(legeMeldungAn).toHaveBeenCalledOnce();
    expect(erfasseEtb).toHaveBeenCalledWith(7, expect.objectContaining({ client_id: 'etb-1' }), {
      offlineQueueBenutzerId: BENUTZER_A,
    });
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
      art: 'person',
      daten: { client_id: 'person-2' },
    });
    renderHook(() => useOfflineSync(BENUTZER_A), { wrapper: wrapperFuer().Wrapper });
    await waitFor(async () =>
      expect(await queueZaehlerLaden(BENUTZER_A, 7)).toEqual({
        ausstehend: 0,
        abgelehnt: 1,
        nicht_zugeordnet: 0,
      }),
    );
    expect(legePersonAn).toHaveBeenCalledOnce();
  });

  it('sendet einen wegen weggeräumter Anhänge abgelehnten ETB-Eintrag ohne sie (LFH-746)', async () => {
    // Der Server kennt die Dateien nach der Karenz des Verwaisten-Sweeps nicht mehr: jede
    // Anfrage, die sie nennt, endet in 400 und legt nichts an.
    vi.mocked(erfasseEtb).mockImplementation(async (_einsatzId, eintrag) => {
      if (eintrag.anhang_ids?.length) {
        throw new ApiError(400, 'Anhang unbekannt oder nicht mehr vorhanden');
      }
      return {} as Awaited<ReturnType<typeof erfasseEtb>>;
    });
    await queueEinreihen(BENUTZER_A, 7, {
      typ: 'meldung',
      inhalt: 'Lagefoto Brücke',
      client_id: 'etb-mit-foto',
      anhang_ids: [41],
    });
    renderHook(() => useOfflineSync(BENUTZER_A), { wrapper: wrapperFuer().Wrapper });

    await waitFor(async () => expect(await abgelehntLaden(BENUTZER_A, 7)).toHaveLength(1));
    const [abgelehnt] = await abgelehntLaden(BENUTZER_A, 7);
    expect(abgelehnt.grund).toBe('Anhang unbekannt oder nicht mehr vorhanden');

    expect(await abgelehntOhneAnhaengeWiederholen(BENUTZER_A, abgelehnt.id!)).toBe(true);

    await waitFor(async () =>
      expect(await queueZaehlerLaden(BENUTZER_A, 7)).toEqual({
        ausstehend: 0,
        abgelehnt: 0,
        nicht_zugeordnet: 0,
      }),
    );
    expect(erfasseEtb).toHaveBeenCalledTimes(2);
    expect(erfasseEtb).toHaveBeenLastCalledWith(
      7,
      { typ: 'meldung', inhalt: 'Lagefoto Brücke', client_id: 'etb-mit-foto' },
      { offlineQueueBenutzerId: BENUTZER_A },
    );
  });

  it('sendet nach einem Benutzerwechsel ausschließlich die neue Identität', async () => {
    online(false);
    await schreibaktionEinreihen(BENUTZER_A, 7, {
      art: 'person',
      daten: { name: 'A', client_id: 'person-a' },
    });
    await schreibaktionEinreihen(BENUTZER_B, 7, {
      art: 'person',
      daten: { name: 'B', client_id: 'person-b' },
    });
    const { Wrapper } = wrapperFuer();
    const { rerender } = renderHook(({ benutzerId }) => useOfflineSync(benutzerId), {
      wrapper: Wrapper,
      initialProps: { benutzerId: BENUTZER_A },
    });

    rerender({ benutzerId: BENUTZER_B });
    online(true);
    window.dispatchEvent(new Event('online'));

    await waitFor(async () =>
      expect(await queueZaehlerLaden(BENUTZER_B, 7)).toMatchObject({
        ausstehend: 0,
      }),
    );
    expect(await queueZaehlerLaden(BENUTZER_A, 7)).toMatchObject({ ausstehend: 1 });
    expect(legePersonAn).toHaveBeenCalledTimes(1);
    expect(legePersonAn).toHaveBeenCalledWith(7, expect.objectContaining({ name: 'B' }), {
      offlineQueueBenutzerId: BENUTZER_B,
    });
  });

  it('holt einen während des Flushs eingereihten Datensatz im Dirty-Nachlauf ab', async () => {
    let erstenAufloesen!: (person: Person) => void;
    vi.mocked(legePersonAn)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            erstenAufloesen = resolve;
          }),
      )
      .mockResolvedValueOnce({ id: 2 } as Person);
    await schreibaktionEinreihen(BENUTZER_A, 7, {
      art: 'person',
      daten: { name: 'Erste', client_id: 'person-1' },
    });
    renderHook(() => useOfflineSync(BENUTZER_A), { wrapper: wrapperFuer().Wrapper });
    await waitFor(() => expect(legePersonAn).toHaveBeenCalledOnce());

    await schreibaktionEinreihen(BENUTZER_A, 7, {
      art: 'person',
      daten: { name: 'Zweite', client_id: 'person-2' },
    });
    erstenAufloesen({ id: 1 } as Person);

    await waitFor(() => expect(legePersonAn).toHaveBeenCalledTimes(2));
    await waitFor(async () =>
      expect(await queueZaehlerLaden(BENUTZER_A, 7)).toMatchObject({
        ausstehend: 0,
      }),
    );
  });

  it('wartet auf Web Locks und liest die Queue erst nach Lock-Erhalt neu', async () => {
    let lockFreigeben!: () => void;
    const request = vi.fn(
      (_name: string, callback: (lock: Lock) => Promise<boolean>) =>
        new Promise<boolean>((resolve, reject) => {
          lockFreigeben = () => void callback({} as Lock).then(resolve, reject);
        }),
    );
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: { request } as unknown as LockManager,
    });
    await schreibaktionEinreihen(BENUTZER_A, 7, {
      art: 'person',
      daten: { name: 'Vor Lock', client_id: 'person-lock-1' },
    });
    renderHook(() => useOfflineSync(BENUTZER_A), { wrapper: wrapperFuer().Wrapper });
    await waitFor(() => expect(request).toHaveBeenCalledOnce());
    expect(request.mock.calls[0]).toHaveLength(2);

    await schreibaktionEinreihen(BENUTZER_A, 7, {
      art: 'person',
      daten: { name: 'Im Lock-Warten', client_id: 'person-lock-2' },
    });
    lockFreigeben();

    await waitFor(() => expect(legePersonAn).toHaveBeenCalledTimes(2));
    await waitFor(async () =>
      expect(await queueZaehlerLaden(BENUTZER_A, 7)).toMatchObject({
        ausstehend: 0,
      }),
    );
    expect(request).toHaveBeenCalledOnce();
  });

  it('bearbeitet weitere Einsätze trotz transientem Fehler im ersten Einsatz', async () => {
    vi.mocked(legePersonAn).mockImplementation(async (einsatzId) => {
      if (einsatzId === 7) throw new NetzFehler();
      return { id: 8 } as Person;
    });
    await schreibaktionEinreihen(BENUTZER_A, 7, {
      art: 'person',
      daten: { client_id: 'transient' },
    });
    await schreibaktionEinreihen(BENUTZER_A, 8, {
      art: 'person',
      daten: { client_id: 'erfolgreich' },
    });
    const { unmount } = renderHook(() => useOfflineSync(BENUTZER_A), {
      wrapper: wrapperFuer().Wrapper,
    });

    await waitFor(() =>
      expect(legePersonAn).toHaveBeenCalledWith(
        8,
        expect.objectContaining({ client_id: 'erfolgreich' }),
        { offlineQueueBenutzerId: BENUTZER_A },
      ),
    );
    expect(await queueZaehlerLaden(BENUTZER_A, 7)).toMatchObject({ ausstehend: 1 });
    expect(await queueZaehlerLaden(BENUTZER_A, 8)).toMatchObject({ ausstehend: 0 });
    unmount();
  });

  it('behält eine stale Cross-Tab-Queue bei 412 transient, ohne die Sitzung abzumelden', async () => {
    vi.mocked(legePersonAn).mockRejectedValue(
      new ApiError(412, 'Offline-Queue gehört zu einem anderen Benutzer'),
    );
    await schreibaktionEinreihen(BENUTZER_A, 7, {
      art: 'person',
      daten: { name: 'Alter Tab', client_id: 'stale-tab-1' },
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
      art: 'person',
      daten: { client_id: 'korrelation-1' },
    });

    renderHook(() => useOfflineSync(BENUTZER_A), { wrapper: Wrapper });
    await waitFor(() => expect(ereignisse).toHaveLength(1));
    expect(client.getQueryData<Person[]>(einsatzKeys.personen(7))).toEqual([vorhanden, gesendet]);
    expect(client.getQueryState(einsatzKeys.personen(7))?.isInvalidated).toBe(true);
    expect(ereignisse[0]).toMatchObject({
      art: 'person',
      benutzerId: BENUTZER_A,
      einsatzId: 7,
      clientId: 'korrelation-1',
      daten: gesendet,
    });
    window.removeEventListener(OFFLINE_SCHREIBAKTION_GESENDET_EVENT, listener);
  });

  it('überträgt die vorgemerkte UHS und invalidiert ihre Ansichten nach dem Replay', async () => {
    const { client, Wrapper } = wrapperFuer();
    client.setQueryData(einsatzKeys.uhs(7), []);
    client.setQueryData(einsatzKeys.uhsDetail(7, 9), {});
    vi.mocked(legePersonAn).mockResolvedValue({ id: 42, aktuelle_uhs_id: 9 } as Person);
    await schreibaktionEinreihen(BENUTZER_A, 7, {
      art: 'person',
      daten: { client_id: 'uhs-replay', uhs_id: 9 },
    });
    renderHook(() => useOfflineSync(BENUTZER_A), { wrapper: Wrapper });
    await waitFor(() =>
      expect(client.getQueryState(einsatzKeys.uhsDetail(7, 9))?.isInvalidated).toBe(true),
    );
    expect(client.getQueryState(einsatzKeys.uhs(7))?.isInvalidated).toBe(true);
    expect(legePersonAn).toHaveBeenCalledExactlyOnceWith(
      7,
      { client_id: 'uhs-replay', uhs_id: 9 },
      { offlineQueueBenutzerId: BENUTZER_A },
    );
    expect(await queueZaehlerLaden(BENUTZER_A, 7)).toMatchObject({ ausstehend: 0 });
  });

  it('erzeugt ohne bestehenden Personen-Cache keine unvollständige Singleton-Liste', async () => {
    const { client, Wrapper } = wrapperFuer();
    vi.mocked(legePersonAn).mockResolvedValue({ id: 42 } as Person);
    await schreibaktionEinreihen(BENUTZER_A, 7, {
      art: 'person',
      daten: { client_id: 'ohne-cache' },
    });
    renderHook(() => useOfflineSync(BENUTZER_A), { wrapper: Wrapper });

    await waitFor(() => expect(legePersonAn).toHaveBeenCalledOnce());
    expect(client.getQueryData(einsatzKeys.personen(7))).toBeUndefined();
  });
});

describe('Stand- und Belegungsmeldungen in der Offline-Queue (LFH-675)', () => {
  const stand = {
    art: 'stand' as const,
    bezirk_id: 3,
    bezeichnung: 'Uferstraße',
    daten: {
      evakuiert: 200,
      erhebung: 'gezaehlt' as const,
      zeitpunkt_at: '2026-09-24 10:00:00',
      client_id: 'stand-1',
    },
  };
  const belegung = {
    art: 'belegung' as const,
    stelle_id: 4,
    bezeichnung: 'Turnhalle Ost',
    daten: { belegt: 37, zeitpunkt_at: '2026-09-24 10:01:00', client_id: 'beleg-1' },
  };

  it('sendet beide mit dem Queue-Besitzer, entfernt sie und invalidiert Betreuung und ETB', async () => {
    const { client, Wrapper } = wrapperFuer();
    client.setQueryData(einsatzKeys.betreuung(7), {});
    client.setQueryData(einsatzKeys.betreuungKopfzahl(7), {});
    client.setQueryData(einsatzKeys.etb(7), []);
    vi.mocked(meldeStand).mockResolvedValue({} as Awaited<ReturnType<typeof meldeStand>>);
    vi.mocked(meldeBelegung).mockResolvedValue({} as Awaited<ReturnType<typeof meldeBelegung>>);
    await schreibaktionEinreihen(BENUTZER_A, 7, stand);
    await schreibaktionEinreihen(BENUTZER_A, 7, belegung);

    renderHook(() => useOfflineSync(BENUTZER_A), { wrapper: Wrapper });
    await waitFor(async () =>
      expect(await queueZaehlerLaden(BENUTZER_A, 7)).toMatchObject({ ausstehend: 0, abgelehnt: 0 }),
    );
    expect(meldeStand).toHaveBeenCalledExactlyOnceWith(7, 3, stand.daten, {
      offlineQueueBenutzerId: BENUTZER_A,
    });
    expect(meldeBelegung).toHaveBeenCalledExactlyOnceWith(7, 4, belegung.daten, {
      offlineQueueBenutzerId: BENUTZER_A,
    });
    expect(legeMeldungAn).not.toHaveBeenCalled();
    expect(client.getQueryState(einsatzKeys.betreuung(7))?.isInvalidated).toBe(true);
    expect(client.getQueryState(einsatzKeys.betreuungKopfzahl(7))?.isInvalidated).toBe(true);
    expect(client.getQueryState(einsatzKeys.etb(7))?.isInvalidated).toBe(true);
  });

  it('legt eine fachlich abgelehnte Meldung unter „abgelehnt“ ab', async () => {
    vi.mocked(meldeBelegung).mockRejectedValue(new ApiError(422, 'Stelle geschlossen'));
    await schreibaktionEinreihen(BENUTZER_A, 7, belegung);
    renderHook(() => useOfflineSync(BENUTZER_A), { wrapper: wrapperFuer().Wrapper });
    await waitFor(async () =>
      expect(await queueZaehlerLaden(BENUTZER_A, 7)).toMatchObject({ ausstehend: 0, abgelehnt: 1 }),
    );
  });

  it('lässt sie bei einem transienten Fehler stehen', async () => {
    vi.mocked(meldeStand).mockRejectedValue(new NetzFehler());
    await schreibaktionEinreihen(BENUTZER_A, 7, stand);
    const { unmount } = renderHook(() => useOfflineSync(BENUTZER_A), {
      wrapper: wrapperFuer().Wrapper,
    });
    await waitFor(() => expect(meldeStand).toHaveBeenCalled());
    expect(await queueZaehlerLaden(BENUTZER_A, 7)).toMatchObject({ ausstehend: 1, abgelehnt: 0 });
    unmount();
  });
});

describe('Verpflegungsausgaben in der Offline-Queue (LFH-688)', () => {
  const ausgabe = {
    art: 'ausgabe' as const,
    zeitfenster_id: 9,
    bezeichnung: 'Mittag',
    daten: { menge: 120, zeitpunkt_at: '2026-09-24 09:40:00', client_id: 'ausgabe-1' },
  };
  const fenster = (id: number, gesamt: number) =>
    ({ id, ausgegeben: { gesamt } }) as unknown as VerpflegungZeitfenster;

  it('schreibt das bestätigte Zeitfenster vor dem Entfernen in den Cache und invalidiert', async () => {
    const { client, Wrapper } = wrapperFuer();
    client.setQueryData<Verpflegung>(einsatzKeys.verpflegung(7), {
      zeitfenster: [fenster(8, 0), fenster(9, 100)],
      stellen: [],
      empfaenger: { einheiten: [], abschnitte: [] },
    });
    vi.mocked(erfasseAusgabe).mockResolvedValue({ ausgabe_id: 5, zeitfenster: fenster(9, 220) });
    await schreibaktionEinreihen(BENUTZER_A, 7, ausgabe);
    // Beim Entfernen der Zeile (Queue-Ereignis) muss die Ausgabe schon bestätigt im Cache stehen,
    // sonst fehlte sie einen Takt lang auf der Karte (design.md D7).
    const beimEntfernen: (number | undefined)[] = [];
    const merke = () =>
      beimEntfernen.push(
        client
          .getQueryData<Verpflegung>(einsatzKeys.verpflegung(7))
          ?.zeitfenster.find((z) => z.id === 9)?.ausgegeben.gesamt,
      );
    window.addEventListener(OFFLINE_QUEUE_EVENT, merke);
    try {
      renderHook(() => useOfflineSync(BENUTZER_A), { wrapper: Wrapper });
      await waitFor(async () =>
        expect(await queueZaehlerLaden(BENUTZER_A, 7)).toMatchObject({
          ausstehend: 0,
          abgelehnt: 0,
        }),
      );
    } finally {
      window.removeEventListener(OFFLINE_QUEUE_EVENT, merke);
    }
    expect(erfasseAusgabe).toHaveBeenCalledExactlyOnceWith(7, 9, ausgabe.daten, {
      offlineQueueBenutzerId: BENUTZER_A,
    });
    expect(beimEntfernen[0]).toBe(220);
    expect(
      client.getQueryData<Verpflegung>(einsatzKeys.verpflegung(7))?.zeitfenster.map((z) => z.id),
    ).toEqual([8, 9]);
    expect(client.getQueryState(einsatzKeys.verpflegung(7))?.isInvalidated).toBe(true);
    expect(legeMeldungAn).not.toHaveBeenCalled();
  });

  it('ein gesammeltes Bündel (10 EP, 2 vegetarisch) steht ausstehend, wird gesendet und steht danach genau einmal da (LLH-1032)', async () => {
    const { client, Wrapper } = wrapperFuer();
    const vorher = zeitfenster({
      id: 9,
      einsatz_id: 7,
      ausgaben: [serverAusgabe({ id: 4, zeitfenster_id: 9 })],
    });
    client.setQueryData<Verpflegung>(einsatzKeys.verpflegung(7), {
      zeitfenster: [vorher],
      stellen: [],
      empfaenger: { einheiten: [], abschnitte: [] },
    });
    const nachher = zeitfenster({
      id: 9,
      einsatz_id: 7,
      ausgegeben: {
        gesamt: vorher.ausgegeben.gesamt + 10,
        sonderkost: { ...vorher.ausgegeben.sonderkost, vegetarisch: 2 },
      },
      ausgaben: [
        ...vorher.ausgaben,
        serverAusgabe({
          id: 5,
          zeitfenster_id: 9,
          menge: 10,
          sonderkost: { ...KEINE_SONDERKOST, vegetarisch: 2 },
        }),
      ],
    });
    vi.mocked(erfasseAusgabe).mockResolvedValue({ ausgabe_id: 5, zeitfenster: nachher });

    // Verlassen der Ansicht ohne Netz: das Bündel geht direkt in die Warteschlange (D5).
    online(false);
    await merkeVerpflegungsausgabeVor(
      BENUTZER_A,
      7,
      { id: 9, bezeichnung: 'Mittag' },
      {
        menge: 10,
        sonderkost: { vegetarisch: 2 },
      },
    );
    const vorgemerkt = renderHook(() => useVorgemerkteAusgaben(BENUTZER_A, 7), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(vorgemerkt.result.current).toHaveLength(1));
    expect(vorgemerkt.result.current[0].aktion).toMatchObject({
      zeitfenster_id: 9,
      daten: { menge: 10, sonderkost: { vegetarisch: 2 } },
    });

    const beimEntfernen: (number | undefined)[] = [];
    const merke = () =>
      beimEntfernen.push(
        client.getQueryData<Verpflegung>(einsatzKeys.verpflegung(7))?.zeitfenster[0].ausgegeben
          .gesamt,
      );
    window.addEventListener(OFFLINE_QUEUE_EVENT, merke);
    try {
      online(true);
      renderHook(() => useOfflineSync(BENUTZER_A), { wrapper: Wrapper });
      await waitFor(async () =>
        expect(await queueZaehlerLaden(BENUTZER_A, 7)).toMatchObject({
          ausstehend: 0,
          abgelehnt: 0,
        }),
      );
    } finally {
      window.removeEventListener(OFFLINE_QUEUE_EVENT, merke);
    }
    expect(erfasseAusgabe).toHaveBeenCalledExactlyOnceWith(
      7,
      9,
      {
        menge: 10,
        sonderkost: { vegetarisch: 2 },
        zeitpunkt_at: expect.any(String),
        client_id: expect.any(String),
      },
      { offlineQueueBenutzerId: BENUTZER_A },
    );
    // Beim Entfernen der Zeile steht die bestätigte Menge schon im Cache: kein Takt ohne sie.
    expect(beimEntfernen[0]).toBe(vorher.ausgegeben.gesamt + 10);
    const zf = client.getQueryData<Verpflegung>(einsatzKeys.verpflegung(7))!.zeitfenster[0];
    expect(zf.ausgegeben).toMatchObject({
      gesamt: vorher.ausgegeben.gesamt + 10,
      sonderkost: { vegetarisch: 2 },
    });
    expect(zf.ausgaben.filter((a) => a.id === 5)).toHaveLength(1);
    await waitFor(() => expect(vorgemerkt.result.current).toHaveLength(0));
  });

  it('legt ohne vorhandenen Cache keinen an', async () => {
    const { client, Wrapper } = wrapperFuer();
    vi.mocked(erfasseAusgabe).mockResolvedValue({ ausgabe_id: 5, zeitfenster: fenster(9, 220) });
    await schreibaktionEinreihen(BENUTZER_A, 7, ausgabe);
    renderHook(() => useOfflineSync(BENUTZER_A), { wrapper: Wrapper });
    await waitFor(async () =>
      expect(await queueZaehlerLaden(BENUTZER_A, 7)).toMatchObject({ ausstehend: 0 }),
    );
    expect(client.getQueryData(einsatzKeys.verpflegung(7))).toBeUndefined();
  });

  it('legt eine abgelehnte Ausgabe (gelöschtes Zeitfenster, 404) unter „abgelehnt“ ab', async () => {
    vi.mocked(erfasseAusgabe).mockRejectedValue(new ApiError(404, 'Nicht gefunden'));
    await schreibaktionEinreihen(BENUTZER_A, 7, ausgabe);
    renderHook(() => useOfflineSync(BENUTZER_A), { wrapper: wrapperFuer().Wrapper });
    await waitFor(async () =>
      expect(await queueZaehlerLaden(BENUTZER_A, 7)).toMatchObject({ ausstehend: 0, abgelehnt: 1 }),
    );
  });

  it('legt eine Ausgabe an einer inzwischen aufgelösten Stelle (409) samt Stelle unter „abgelehnt“ ab (LLH-1040)', async () => {
    vi.mocked(erfasseAusgabe).mockRejectedValue(
      new ApiError(409, 'Die Verpflegungsstelle ist aufgelöst'),
    );
    const anStelle = { ...ausgabe, daten: { ...ausgabe.daten, verpflegungsstelle_id: 21 } };
    await schreibaktionEinreihen(BENUTZER_A, 7, anStelle);
    renderHook(() => useOfflineSync(BENUTZER_A), { wrapper: wrapperFuer().Wrapper });
    await waitFor(async () =>
      expect(await queueZaehlerLaden(BENUTZER_A, 7)).toMatchObject({ ausstehend: 0, abgelehnt: 1 }),
    );
    const [abgelehnt] = await schreibaktionenAbgelehntLaden(BENUTZER_A, 7);
    expect(abgelehnt.aktion).toMatchObject({ daten: { verpflegungsstelle_id: 21 } });
    expect(abgelehnt.grund).toContain('aufgelöst');
  });

  it('lässt sie bei einem transienten Fehler stehen', async () => {
    vi.mocked(erfasseAusgabe).mockRejectedValue(new NetzFehler());
    await schreibaktionEinreihen(BENUTZER_A, 7, ausgabe);
    const { unmount } = renderHook(() => useOfflineSync(BENUTZER_A), {
      wrapper: wrapperFuer().Wrapper,
    });
    await waitFor(() => expect(erfasseAusgabe).toHaveBeenCalled());
    expect(await queueZaehlerLaden(BENUTZER_A, 7)).toMatchObject({ ausstehend: 1, abgelehnt: 0 });
    unmount();
  });
});

describe('Eintreffen am Bereitstellungsraum in der Offline-Queue (LLH-1075 Teil III)', () => {
  const eintreffen = {
    art: 'eintreffen' as const,
    br_id: 4,
    bezeichnung: 'BR Sportplatz',
    name: 'FL-MUS 1-44-1',
    daten: {
      unangemeldet: { fahrzeuge: [{ funkrufname: 'FL-MUS 1-44-1' }] },
      client_id: 'eintreffen-1',
      zeitpunkt_at: '2026-10-16 12:12:00',
    },
  };
  const ergebnis = { einheit_id: 30, fahrzeug_ids: [5] } as Awaited<
    ReturnType<typeof bucheEintreffen>
  >;

  it('sendet mit dem Queue-Besitzer, lädt Raum und Kräfte nach, bevor die Zeile verschwindet', async () => {
    const { client, Wrapper } = wrapperFuer();
    const keys = [
      einsatzKeys.br(7),
      einsatzKeys.brDetail(7, 4),
      einsatzKeys.brVerlauf(7, 4),
      einsatzKeys.einheiten(7),
      einsatzKeys.fahrzeuge(7),
      einsatzKeys.kraefteZeitachse(7),
      einsatzKeys.meldungen(7),
      einsatzKeys.etb(7),
    ];
    for (const key of keys) client.setQueryData(key, []);
    vi.mocked(bucheEintreffen).mockResolvedValue(ergebnis);
    await schreibaktionEinreihen(BENUTZER_A, 7, eintreffen);
    const beimEntfernen: (boolean | undefined)[] = [];
    const merke = () =>
      beimEntfernen.push(client.getQueryState(einsatzKeys.brDetail(7, 4))?.isInvalidated);
    window.addEventListener(OFFLINE_QUEUE_EVENT, merke);
    try {
      renderHook(() => useOfflineSync(BENUTZER_A), { wrapper: Wrapper });
      await waitFor(async () =>
        expect(await queueZaehlerLaden(BENUTZER_A, 7)).toMatchObject({
          ausstehend: 0,
          abgelehnt: 0,
        }),
      );
    } finally {
      window.removeEventListener(OFFLINE_QUEUE_EVENT, merke);
    }
    expect(bucheEintreffen).toHaveBeenCalledExactlyOnceWith(7, 4, eintreffen.daten, {
      offlineQueueBenutzerId: BENUTZER_A,
    });
    expect(beimEntfernen[0]).toBe(true);
    for (const key of keys)
      expect(client.getQueryState(key)?.isInvalidated, String(key)).toBe(true);
  });

  it('abgerissene Antwort: der nächste Versuch sendet dieselbe client_id, die Zeile geht genau einmal', async () => {
    vi.mocked(bucheEintreffen)
      .mockRejectedValueOnce(new AusgangUnbekannt())
      .mockResolvedValueOnce(ergebnis);
    await schreibaktionEinreihen(BENUTZER_A, 7, eintreffen);
    const { unmount } = renderHook(() => useOfflineSync(BENUTZER_A), {
      wrapper: wrapperFuer().Wrapper,
    });
    await waitFor(() => expect(bucheEintreffen).toHaveBeenCalledTimes(1));
    expect(await queueZaehlerLaden(BENUTZER_A, 7)).toMatchObject({ ausstehend: 1, abgelehnt: 0 });
    window.dispatchEvent(new Event('online'));
    await waitFor(async () =>
      expect(await queueZaehlerLaden(BENUTZER_A, 7)).toMatchObject({ ausstehend: 0, abgelehnt: 0 }),
    );
    expect(bucheEintreffen).toHaveBeenCalledTimes(2);
    const [erster, zweiter] = vi.mocked(bucheEintreffen).mock.calls.map((c) => c[2]);
    expect(zweiter).toEqual(erster);
    expect(zweiter.client_id).toBe('eintreffen-1');
    unmount();
  });

  it.each([
    [409, 'HLF 20 steht schon im Bereitstellungsraum BR Schule'],
    [422, 'Bereitstellungsraum ist nicht aktiv'],
    [403, 'Keine Berechtigung'],
  ])('legt eine Ablehnung %i beim Nachsenden unter „abgelehnt“ ab', async (status, grund) => {
    vi.mocked(bucheEintreffen).mockRejectedValue(new ApiError(status, grund));
    await schreibaktionEinreihen(BENUTZER_A, 7, eintreffen);
    renderHook(() => useOfflineSync(BENUTZER_A), { wrapper: wrapperFuer().Wrapper });
    await waitFor(async () =>
      expect(await queueZaehlerLaden(BENUTZER_A, 7)).toMatchObject({ ausstehend: 0, abgelehnt: 1 }),
    );
    expect(await schreibaktionenAbgelehntLaden(BENUTZER_A, 7)).toEqual([
      expect.objectContaining({ aktion: eintreffen, grund }),
    ]);
  });
});

describe('Einträge einer Person in der Offline-Queue (LLH-1138, design.md D8)', () => {
  const faelle = [
    {
      art: 'sichtung' as const,
      api: erfasseSichtung,
      daten: { kategorie: 'sk1' as const, notiz: null, bestaetigt_personal_id: 5 },
    },
    { art: 'verbleib' as const, api: erfasseVerbleib, daten: { art: 'transport' as const } },
    { art: 'notiz' as const, api: legeNotizAn, daten: { text: 'Infusion läuft' } },
    {
      art: 'transport' as const,
      api: saveTransport,
      daten: { prioritaet: 'dringlich' as const, art: null, fachrichtung: null },
    },
    { art: 'massnahme' as const, api: createMassnahme, daten: { art: 'zugang' as const } },
    {
      art: 'verletzung' as const,
      api: createVerletzung,
      daten: { ansicht: 'vorn' as const, region: 'kopf' as const, art: 'wunde' as const },
    },
  ];
  const aktion = <F extends (typeof faelle)[number]>(f: F) =>
    ({
      art: f.art,
      person_id: 10,
      bezeichnung: 'R-012',
      daten: { ...f.daten, client_id: `${f.art}-1`, zeitpunkt_at: '2026-10-18 14:10:00' },
    }) as Parameters<typeof schreibaktionEinreihen>[2];

  it.each(faelle)(
    '$art: sendet genau einmal mit Erfassungszeit und Queue-Besitzer, lädt das Detail vor dem Entfernen',
    async (f) => {
      const { client, Wrapper } = wrapperFuer();
      const keys = [
        einsatzKeys.person(7, 10),
        einsatzKeys.personen(7),
        einsatzKeys.personenAuswahl(7),
        einsatzKeys.etb(7),
      ];
      for (const key of keys) client.setQueryData(key, []);
      vi.mocked(f.api).mockResolvedValue({ id: 99 } as never);
      const eintrag = aktion(f);
      await schreibaktionEinreihen(BENUTZER_A, 7, eintrag);
      const beimEntfernen: (boolean | undefined)[] = [];
      const merke = () =>
        beimEntfernen.push(client.getQueryState(einsatzKeys.person(7, 10))?.isInvalidated);
      window.addEventListener(OFFLINE_QUEUE_EVENT, merke);
      try {
        renderHook(() => useOfflineSync(BENUTZER_A), { wrapper: Wrapper });
        await waitFor(async () =>
          expect(await queueZaehlerLaden(BENUTZER_A, 7)).toMatchObject({
            ausstehend: 0,
            abgelehnt: 0,
          }),
        );
      } finally {
        window.removeEventListener(OFFLINE_QUEUE_EVENT, merke);
      }
      expect(f.api).toHaveBeenCalledExactlyOnceWith(7, 10, (eintrag as { daten: unknown }).daten, {
        offlineQueueBenutzerId: BENUTZER_A,
      });
      expect(beimEntfernen[0]).toBe(true);
      for (const key of keys)
        expect(client.getQueryState(key)?.isInvalidated, String(key)).toBe(true);
    },
  );

  it('ein Verbleib lädt auch die UHS der Person nach (Austritt aus der UHS)', async () => {
    const { client, Wrapper } = wrapperFuer();
    client.setQueryData(einsatzKeys.personen(7), [{ id: 10, aktuelle_uhs_id: 3 } as Person]);
    client.setQueryData(einsatzKeys.uhs(7), []);
    client.setQueryData(einsatzKeys.uhsDetail(7, 3), {});
    vi.mocked(erfasseVerbleib).mockResolvedValue({ id: 99 } as never);
    await schreibaktionEinreihen(BENUTZER_A, 7, aktion(faelle[1]));
    renderHook(() => useOfflineSync(BENUTZER_A), { wrapper: Wrapper });
    await waitFor(async () =>
      expect(await queueZaehlerLaden(BENUTZER_A, 7)).toMatchObject({ ausstehend: 0 }),
    );
    expect(client.getQueryState(einsatzKeys.uhs(7))?.isInvalidated).toBe(true);
    expect(client.getQueryState(einsatzKeys.uhsDetail(7, 3))?.isInvalidated).toBe(true);
  });

  it('abgerissene Antwort: der nächste Versuch sendet dieselbe client_id, die Notiz steht einmal', async () => {
    vi.mocked(legeNotizAn)
      .mockRejectedValueOnce(new AusgangUnbekannt())
      .mockResolvedValueOnce({ id: 99 } as never);
    await schreibaktionEinreihen(BENUTZER_A, 7, aktion(faelle[2]));
    const { unmount } = renderHook(() => useOfflineSync(BENUTZER_A), {
      wrapper: wrapperFuer().Wrapper,
    });
    await waitFor(() => expect(legeNotizAn).toHaveBeenCalledTimes(1));
    expect(await queueZaehlerLaden(BENUTZER_A, 7)).toMatchObject({ ausstehend: 1, abgelehnt: 0 });
    window.dispatchEvent(new Event('online'));
    await waitFor(async () =>
      expect(await queueZaehlerLaden(BENUTZER_A, 7)).toMatchObject({ ausstehend: 0, abgelehnt: 0 }),
    );
    const [erster, zweiter] = vi.mocked(legeNotizAn).mock.calls.map((c) => c[2]);
    expect(zweiter).toEqual(erster);
    expect(zweiter.client_id).toBe('notiz-1');
    unmount();
  });

  it.each([
    [422, 'Person ist nicht anwesend (Status vermisst)'],
    [409, 'Stornierte Person kann nicht gesichtet werden'],
    [403, 'Keine Berechtigung'],
  ])('legt eine Ablehnung %i mit Grund unter „abgelehnt“ ab', async (status, grund) => {
    vi.mocked(erfasseSichtung).mockRejectedValue(new ApiError(status, grund));
    const eintrag = aktion(faelle[0]);
    await schreibaktionEinreihen(BENUTZER_A, 7, eintrag);
    renderHook(() => useOfflineSync(BENUTZER_A), { wrapper: wrapperFuer().Wrapper });
    await waitFor(async () =>
      expect(await queueZaehlerLaden(BENUTZER_A, 7)).toMatchObject({ ausstehend: 0, abgelehnt: 1 }),
    );
    expect(await schreibaktionenAbgelehntLaden(BENUTZER_A, 7)).toEqual([
      expect.objectContaining({ aktion: eintrag, grund }),
    ]);
  });
});

/** LFH-387: während eines Benutzerkonflikts scheitert jeder Abgleich am Server (412) und stieße
 *  jedes Mal eine Prüfung an — also pausieren, statt alle 30 s gegen die Wand zu laufen. */
describe('abgleichFuer (LFH-387)', () => {
  const anna = { id: 1 } as Parameters<typeof abgleichFuer>[0];
  it('gleicht für den angemeldeten Benutzer ab', () => {
    expect(abgleichFuer(anna, false)).toBe(1);
  });
  it('pausiert während eines Konflikts und ohne Benutzer', () => {
    expect(abgleichFuer(anna, true)).toBeUndefined();
    expect(abgleichFuer(null, false)).toBeUndefined();
  });
});
