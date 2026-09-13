import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, NetzFehler } from '../api/client';
import { legePersonAn } from '../api/einsatzPerson';
import { legeMeldungAn } from '../api/meldungen';
import { queueLeerenFuerTests, schreibaktionenLaden } from './queue';
import { erfasseMeldungOfflineFaehig, erfassePersonOfflineFaehig } from './schreiben';

vi.mock('../api/einsatzPerson', async (importOriginal) => {
  const original = await importOriginal<typeof import('../api/einsatzPerson')>();
  return { ...original, legePersonAn: vi.fn() };
});
vi.mock('../api/meldungen', () => ({ legeMeldungAn: vi.fn() }));

function online(wert: boolean): void {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: wert });
}

beforeEach(async () => {
  vi.clearAllMocks();
  online(true);
  await queueLeerenFuerTests();
});

describe('offlinefähige Fachschreibvorgänge (LFH-334)', () => {
  it('merkt eine vermisste Person offline atomar mit stabiler client_id vor', async () => {
    online(false);
    const ergebnis = await erfassePersonOfflineFaehig(11, 7, {
      name: 'Muster',
      status: 'vermisst',
      client_id: 'person-1',
    });
    expect(ergebnis).toEqual({ zustand: 'vorgemerkt', client_id: 'person-1' });
    expect(legePersonAn).not.toHaveBeenCalled();
    expect(await schreibaktionenLaden(11, 7)).toEqual([
      expect.objectContaining({
        aktion: {
          art: 'person',
          daten: { name: 'Muster', status: 'vermisst', client_id: 'person-1' },
        },
      }),
    ]);
  });

  it('reiht einen normalisierten Netzfehler ein, fachliche 4xx aber nicht', async () => {
    vi.mocked(legePersonAn).mockRejectedValueOnce(new NetzFehler());
    await expect(erfassePersonOfflineFaehig(11, 7, { client_id: 'person-2' })).resolves.toEqual({
      zustand: 'vorgemerkt',
      client_id: 'person-2',
    });

    vi.mocked(legePersonAn).mockRejectedValueOnce(new ApiError(422, 'Ungültig'));
    await expect(
      erfassePersonOfflineFaehig(11, 7, { client_id: 'person-3' }),
    ).rejects.toMatchObject({ status: 422 });
    expect(await schreibaktionenLaden(11, 7)).toHaveLength(1);
    expect(legePersonAn).toHaveBeenNthCalledWith(
      1,
      7,
      expect.objectContaining({ client_id: 'person-2' }),
      { offlineQueueBenutzerId: 11 },
    );
    expect(legePersonAn).toHaveBeenNthCalledWith(
      2,
      7,
      expect.objectContaining({ client_id: 'person-3' }),
      { offlineQueueBenutzerId: 11 },
    );
  });

  it('liefert online die serverseitig nummerierte Meldung zurück', async () => {
    const meldung = { id: 9, lfd_nr: 47 } as Awaited<ReturnType<typeof legeMeldungAn>>;
    vi.mocked(legeMeldungAn).mockResolvedValue(meldung);
    const ergebnis = await erfasseMeldungOfflineFaehig(11, 7, {
      absender: 'ELW',
      meldeweg: 'funk',
      inhalt: 'Lage',
      ereigniszeit: '2026-08-06 12:00:00',
      client_id: 'meldung-1',
    });
    expect(ergebnis).toEqual({ zustand: 'gesendet', daten: meldung });
    expect(legeMeldungAn).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ client_id: 'meldung-1' }),
      { offlineQueueBenutzerId: 11 },
    );
    expect(await schreibaktionenLaden(11, 7)).toHaveLength(0);
  });
});
