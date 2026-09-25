import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { meldeBelegung, meldeStand } from '../api/betreuung';
import { ApiError, NetzFehler } from '../api/client';
import { legePersonAn } from '../api/einsatzPerson';
import { legeMeldungAn } from '../api/meldungen';
import { queueLeerenFuerTests, schreibaktionenLaden } from './queue';
import {
  erfasseBelegungOfflineFaehig,
  erfasseMeldungOfflineFaehig,
  erfassePersonOfflineFaehig,
  erfasseStandOfflineFaehig,
} from './schreiben';

vi.mock('../api/einsatzPerson', async (importOriginal) => {
  const original = await importOriginal<typeof import('../api/einsatzPerson')>();
  return { ...original, legePersonAn: vi.fn() };
});
vi.mock('../api/meldungen', () => ({ legeMeldungAn: vi.fn() }));
vi.mock('../api/betreuung', () => ({ meldeStand: vi.fn(), meldeBelegung: vi.fn() }));

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

describe('offlinefähige Stand- und Belegungsmeldungen (LFH-675)', () => {
  const bezirk = { id: 3, bezeichnung: 'Uferstraße 12–40' };
  const stelle = { id: 4, bezeichnung: 'Turnhalle Ost' };

  // Nur `Date` fälschen: IndexedDB (fake-indexeddb) hängt an echten Timern.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-24T08:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('merkt offline mit dem Erfassungszeitpunkt vor (D6)', async () => {
    online(false);
    const ergebnis = await erfasseStandOfflineFaehig(11, 7, bezirk, {
      evakuiert: 200,
      erhebung: 'gezaehlt',
      client_id: 'stand-1',
    });
    expect(ergebnis).toEqual({ zustand: 'vorgemerkt', client_id: 'stand-1' });
    expect(meldeStand).not.toHaveBeenCalled();
    expect(await schreibaktionenLaden(11, 7)).toEqual([
      expect.objectContaining({
        aktion: {
          art: 'stand',
          bezirk_id: 3,
          bezeichnung: 'Uferstraße 12–40',
          daten: {
            evakuiert: 200,
            erhebung: 'gezaehlt',
            client_id: 'stand-1',
            zeitpunkt_at: '2026-09-24 08:00:00',
          },
        },
      }),
    ]);
  });

  it('lässt einen eingetragenen Zeitpunkt beim Vormerken stehen', async () => {
    online(false);
    await erfasseBelegungOfflineFaehig(11, 7, stelle, {
      belegt: 37,
      zeitpunkt_at: '2026-09-24 07:30:00',
    });
    const [zeile] = await schreibaktionenLaden(11, 7);
    expect(zeile.aktion).toMatchObject({
      art: 'belegung',
      stelle_id: 4,
      bezeichnung: 'Turnhalle Ost',
      daten: { belegt: 37, zeitpunkt_at: '2026-09-24 07:30:00' },
    });
    expect(zeile.aktion.daten).toHaveProperty('client_id', expect.any(String));
  });

  it('sendet online ohne zugesetzten Zeitpunkt — der Server nimmt seine Uhr', async () => {
    const antwort = { meldung_id: 5 } as Awaited<ReturnType<typeof meldeBelegung>>;
    vi.mocked(meldeBelegung).mockResolvedValue(antwort);
    const ergebnis = await erfasseBelegungOfflineFaehig(11, 7, stelle, {
      belegt: 37,
      client_id: 'beleg-1',
    });
    expect(ergebnis).toEqual({ zustand: 'gesendet', daten: antwort });
    expect(meldeBelegung).toHaveBeenCalledWith(
      7,
      4,
      { belegt: 37, client_id: 'beleg-1' },
      { offlineQueueBenutzerId: 11 },
    );
    expect(await schreibaktionenLaden(11, 7)).toHaveLength(0);
  });

  it('merkt nach transientem Fehler mit DERSELBEN client_id vor, fachliche 4xx wirft', async () => {
    vi.mocked(meldeStand).mockRejectedValueOnce(new NetzFehler());
    const ergebnis = await erfasseStandOfflineFaehig(11, 7, bezirk, {
      evakuiert: 480,
      erhebung: 'geschaetzt',
    });
    expect(ergebnis.zustand).toBe('vorgemerkt');
    const gesendet = vi.mocked(meldeStand).mock.calls[0][2];
    expect(gesendet.client_id).toEqual(expect.any(String));
    expect(gesendet).not.toHaveProperty('zeitpunkt_at');
    const [zeile] = await schreibaktionenLaden(11, 7);
    expect(zeile.aktion.daten).toEqual({ ...gesendet, zeitpunkt_at: '2026-09-24 08:00:00' });
    expect(ergebnis).toEqual({ zustand: 'vorgemerkt', client_id: gesendet.client_id });

    vi.mocked(meldeStand).mockRejectedValueOnce(new ApiError(409, 'storniert'));
    await expect(
      erfasseStandOfflineFaehig(11, 7, bezirk, { evakuiert: 1, erhebung: 'gezaehlt' }),
    ).rejects.toMatchObject({ status: 409 });
    expect(await schreibaktionenLaden(11, 7)).toHaveLength(1);
  });
});
