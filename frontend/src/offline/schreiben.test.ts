import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { meldeBelegung, meldeStand } from '../api/betreuung';
import { ApiError, NetzFehler } from '../api/client';
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
import { erfasseAusgabe } from '../api/verpflegung';
import { bucheEintreffen } from '../api/einsatzBereitstellungsraum';
import { OFFLINE_QUEUE_EVENT, queueLeerenFuerTests, schreibaktionenLaden } from './queue';
import { merkeServerzeit, serveruhrVergessenFuerTests } from './serveruhr';
import {
  erfasseBelegungOfflineFaehig,
  erfasseEintreffenOfflineFaehig,
  erfasseMeldungOfflineFaehig,
  erfassePersonOfflineFaehig,
  erfasseStandOfflineFaehig,
  erfasseVerpflegungsausgabeOfflineFaehig,
  merkeVerpflegungsausgabeVor,
  savePersonEintragOfflineCapable,
} from './schreiben';

vi.mock('../api/einsatzPerson', async (importOriginal) => {
  const original = await importOriginal<typeof import('../api/einsatzPerson')>();
  return {
    ...original,
    legePersonAn: vi.fn(),
    erfasseSichtung: vi.fn(),
    erfasseVerbleib: vi.fn(),
    legeNotizAn: vi.fn(),
    saveTransport: vi.fn(),
    createMassnahme: vi.fn(),
    createVerletzung: vi.fn(),
  };
});
vi.mock('../api/meldungen', () => ({ legeMeldungAn: vi.fn() }));
vi.mock('../api/betreuung', () => ({ meldeStand: vi.fn(), meldeBelegung: vi.fn() }));
vi.mock('../api/verpflegung', () => ({ erfasseAusgabe: vi.fn() }));
vi.mock('../api/einsatzBereitstellungsraum', () => ({ bucheEintreffen: vi.fn() }));

function online(wert: boolean): void {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: wert });
}

beforeEach(async () => {
  vi.clearAllMocks();
  online(true);
  serveruhrVergessenFuerTests();
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

describe('offlinefähige Verpflegungsausgaben (LFH-688)', () => {
  const mittag = { id: 9, bezeichnung: 'Mittag' };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-24T09:40:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('merkt offline mit dem Erfassungszeitpunkt vor und liest die Aktion unverändert zurück', async () => {
    online(false);
    const ergebnis = await erfasseVerpflegungsausgabeOfflineFaehig(11, 7, mittag, {
      menge: 120,
      ort: 'Verpflegungsstelle Deich',
      sonderkost: { vegan: 3 },
      client_id: 'ausgabe-1',
    });
    expect(ergebnis).toEqual({ zustand: 'vorgemerkt', client_id: 'ausgabe-1' });
    expect(erfasseAusgabe).not.toHaveBeenCalled();
    expect(await schreibaktionenLaden(11, 7)).toEqual([
      expect.objectContaining({
        aktion: {
          art: 'ausgabe',
          zeitfenster_id: 9,
          bezeichnung: 'Mittag',
          daten: {
            menge: 120,
            ort: 'Verpflegungsstelle Deich',
            sonderkost: { vegan: 3 },
            client_id: 'ausgabe-1',
            zeitpunkt_at: '2026-09-24 09:40:00',
          },
        },
      }),
    ]);
  });

  it('lässt einen eingetragenen Zeitpunkt beim Vormerken stehen', async () => {
    online(false);
    await erfasseVerpflegungsausgabeOfflineFaehig(11, 7, mittag, {
      menge: 5,
      zeitpunkt_at: '2026-09-24 07:30:00',
    });
    const [zeile] = await schreibaktionenLaden(11, 7);
    expect(zeile.aktion.daten).toMatchObject({ menge: 5, zeitpunkt_at: '2026-09-24 07:30:00' });
    expect(zeile.aktion.daten).toHaveProperty('client_id', expect.any(String));
  });

  it('sendet online ohne zugesetzten Zeitpunkt — der Server nimmt seine Uhr', async () => {
    const antwort = { ausgabe_id: 5 } as Awaited<ReturnType<typeof erfasseAusgabe>>;
    vi.mocked(erfasseAusgabe).mockResolvedValue(antwort);
    const ergebnis = await erfasseVerpflegungsausgabeOfflineFaehig(11, 7, mittag, {
      menge: 120,
      client_id: 'ausgabe-2',
    });
    expect(ergebnis).toEqual({ zustand: 'gesendet', daten: antwort });
    expect(erfasseAusgabe).toHaveBeenCalledWith(
      7,
      9,
      { menge: 120, client_id: 'ausgabe-2' },
      { offlineQueueBenutzerId: 11 },
    );
    expect(await schreibaktionenLaden(11, 7)).toHaveLength(0);
  });

  it('merkt nach transientem Fehler mit DERSELBEN client_id vor, fachliche 4xx wirft', async () => {
    vi.mocked(erfasseAusgabe).mockRejectedValueOnce(new NetzFehler());
    const ergebnis = await erfasseVerpflegungsausgabeOfflineFaehig(11, 7, mittag, { menge: 120 });
    expect(ergebnis.zustand).toBe('vorgemerkt');
    const gesendet = vi.mocked(erfasseAusgabe).mock.calls[0][2];
    expect(gesendet.client_id).toEqual(expect.any(String));
    expect(gesendet).not.toHaveProperty('zeitpunkt_at');
    const [zeile] = await schreibaktionenLaden(11, 7);
    expect(zeile.aktion.daten).toEqual({ ...gesendet, zeitpunkt_at: '2026-09-24 09:40:00' });
    expect(ergebnis).toEqual({ zustand: 'vorgemerkt', client_id: gesendet.client_id });

    vi.mocked(erfasseAusgabe).mockRejectedValueOnce(new ApiError(404, 'Nicht gefunden'));
    await expect(
      erfasseVerpflegungsausgabeOfflineFaehig(11, 7, mittag, { menge: 1 }),
    ).rejects.toMatchObject({ status: 404 });
    expect(await schreibaktionenLaden(11, 7)).toHaveLength(1);
  });
});

describe('Erfassungszeitpunkt nach der Serveruhr (LFH-705)', () => {
  const bezirk = { id: 3, bezeichnung: 'Uferstraße 12–40' };
  const stelle = { id: 4, bezeichnung: 'Turnhalle Ost' };
  const SERVER = Date.parse('2026-10-01T10:00:00Z');
  const VORLAUF = 5 * 60_000;

  // Die Geräteuhr geht 5 min vor, der Server hat vor dem Ausfall einmal geantwortet.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(SERVER + VORLAUF);
    merkeServerzeit(new Response(null, { headers: { Date: new Date(SERVER).toUTCString() } }));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('merkt Stand- und Belegungsmeldung mit der Serverzeit vor, nicht der Geräteuhr', async () => {
    online(false);
    await erfasseStandOfflineFaehig(11, 7, bezirk, {
      evakuiert: 200,
      erhebung: 'gezaehlt',
      client_id: 'stand-uhr',
    });
    await erfasseBelegungOfflineFaehig(11, 7, stelle, { belegt: 37, client_id: 'beleg-uhr' });
    const zeilen = await schreibaktionenLaden(11, 7);
    expect(zeilen.map((z) => z.aktion.daten)).toEqual([
      expect.objectContaining({ client_id: 'stand-uhr', zeitpunkt_at: '2026-10-01 10:00:00' }),
      expect.objectContaining({ client_id: 'beleg-uhr', zeitpunkt_at: '2026-10-01 10:00:00' }),
    ]);
  });

  it('ohne Messung gilt die Geräteuhr', async () => {
    serveruhrVergessenFuerTests();
    online(false);
    await erfasseBelegungOfflineFaehig(11, 7, stelle, { belegt: 37 });
    const [zeile] = await schreibaktionenLaden(11, 7);
    expect(zeile.aktion.daten).toHaveProperty('zeitpunkt_at', '2026-10-01 10:05:00');
  });

  it('lässt einen eingetragenen Zeitpunkt unverändert', async () => {
    online(false);
    await erfasseStandOfflineFaehig(11, 7, bezirk, {
      evakuiert: 200,
      erhebung: 'gezaehlt',
      zeitpunkt_at: '2026-10-01 09:30:00',
    });
    const [zeile] = await schreibaktionenLaden(11, 7);
    expect(zeile.aktion.daten).toHaveProperty('zeitpunkt_at', '2026-10-01 09:30:00');
  });

  it('der Online-Versuch trägt weiter keinen Zeitpunkt', async () => {
    vi.mocked(meldeStand).mockResolvedValue({} as Awaited<ReturnType<typeof meldeStand>>);
    await erfasseStandOfflineFaehig(11, 7, bezirk, { evakuiert: 480, erhebung: 'gezaehlt' });
    expect(vi.mocked(meldeStand).mock.calls[0][2]).not.toHaveProperty('zeitpunkt_at');
  });

  it('nimmt den Zeitpunkt vor dem Online-Versuch, nicht nach seinem Timeout', async () => {
    vi.mocked(meldeBelegung).mockImplementationOnce(async () => {
      vi.setSystemTime(Date.now() + 15_000);
      throw new NetzFehler();
    });
    await erfasseBelegungOfflineFaehig(11, 7, stelle, { belegt: 37 });
    const [zeile] = await schreibaktionenLaden(11, 7);
    expect(zeile.aktion.daten).toHaveProperty('zeitpunkt_at', '2026-10-01 10:00:00');
  });

  it('stempelt auch eine vorgemerkte Verpflegungsausgabe nach der Serveruhr (LFH-688)', async () => {
    online(false);
    await erfasseVerpflegungsausgabeOfflineFaehig(
      11,
      7,
      { id: 9, bezeichnung: 'Mittag' },
      {
        menge: 120,
        client_id: 'ausgabe-uhr',
      },
    );
    const [zeile] = await schreibaktionenLaden(11, 7);
    expect(zeile.aktion.daten).toHaveProperty('zeitpunkt_at', '2026-10-01 10:00:00');
  });
});

describe('Sammlung direkt vormerken (LLH-1032, design.md D5)', () => {
  const mittag = { id: 9, bezeichnung: 'Mittag' };
  const SERVER = Date.parse('2026-10-01T10:00:00Z');

  // Die Geräteuhr geht 5 min vor; der Server hat einmal geantwortet.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(SERVER + 5 * 60_000);
    merkeServerzeit(new Response(null, { headers: { Date: new Date(SERVER).toUTCString() } }));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('schreibt online ohne Sendeversuch in die Queue, mit client_id und Zeit nach der Serveruhr', async () => {
    const ereignisse: Event[] = [];
    const hoerer = (e: Event) => ereignisse.push(e);
    window.addEventListener(OFFLINE_QUEUE_EVENT, hoerer);
    try {
      const ergebnis = await merkeVerpflegungsausgabeVor(11, 7, mittag, {
        menge: 7,
        sonderkost: { vegetarisch: 2 },
      });
      expect(erfasseAusgabe).not.toHaveBeenCalled();
      const [zeile] = await schreibaktionenLaden(11, 7);
      expect(zeile.aktion).toEqual({
        art: 'ausgabe',
        zeitfenster_id: 9,
        bezeichnung: 'Mittag',
        daten: {
          menge: 7,
          sonderkost: { vegetarisch: 2 },
          client_id: expect.any(String),
          zeitpunkt_at: '2026-10-01 10:00:00',
        },
      });
      expect(ergebnis).toEqual({
        zustand: 'vorgemerkt',
        client_id: (zeile.aktion.daten as { client_id: string }).client_id,
      });
      expect(ereignisse.length).toBeGreaterThan(0);
    } finally {
      window.removeEventListener(OFFLINE_QUEUE_EVENT, hoerer);
    }
  });

  it('eine Sammlung an einer Stelle trägt die Stelle in die Queue (LLH-1040, D13 Punkt 8)', async () => {
    await merkeVerpflegungsausgabeVor(11, 7, mittag, { menge: 4, verpflegungsstelle_id: 21 });
    const [zeile] = await schreibaktionenLaden(11, 7);
    expect(zeile.aktion).toMatchObject({
      art: 'ausgabe',
      zeitfenster_id: 9,
      daten: { menge: 4, verpflegungsstelle_id: 21 },
    });
  });

  it('zwei Sammlungen tragen zwei verschiedene client_id', async () => {
    await merkeVerpflegungsausgabeVor(11, 7, mittag, { menge: 1 });
    await merkeVerpflegungsausgabeVor(11, 7, mittag, { menge: 2 });
    const zeilen = await schreibaktionenLaden(11, 7);
    const ids = zeilen.map((z) => (z.aktion.daten as { client_id: string }).client_id);
    expect(new Set(ids).size).toBe(2);
  });
});

describe('offlinefähiges Eintreffen am Bereitstellungsraum (LLH-1075 Teil III)', () => {
  const sportplatz = { id: 4, bezeichnung: 'BR Sportplatz' };
  const unangemeldet = { unangemeldet: { fahrzeuge: [{ funkrufname: 'FL-MUS 1-44-1' }] } };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-16T12:12:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('merkt offline mit client_id, Erfassungszeitpunkt, Raum und Kraft vor', async () => {
    online(false);
    const ergebnis = await erfasseEintreffenOfflineFaehig(11, 7, sportplatz, 'FL-MUS 1-44-1', {
      ...unangemeldet,
      client_id: 'e-1',
    });
    expect(ergebnis).toEqual({ zustand: 'vorgemerkt', client_id: 'e-1' });
    expect(bucheEintreffen).not.toHaveBeenCalled();
    expect(await schreibaktionenLaden(11, 7)).toEqual([
      expect.objectContaining({
        aktion: {
          art: 'eintreffen',
          br_id: 4,
          bezeichnung: 'BR Sportplatz',
          name: 'FL-MUS 1-44-1',
          daten: { ...unangemeldet, client_id: 'e-1', zeitpunkt_at: '2026-10-16 12:12:00' },
        },
      }),
    ]);
  });

  it('sendet online mit client_id und Queue-Besitzer, ohne Zeitpunkt', async () => {
    const antwort = { einheit_id: 30 } as Awaited<ReturnType<typeof bucheEintreffen>>;
    vi.mocked(bucheEintreffen).mockResolvedValue(antwort);
    const kraft = { kraft: { objekt_typ: 'einheit' as const, objekt_id: 30 } };
    const ergebnis = await erfasseEintreffenOfflineFaehig(11, 7, sportplatz, 'HLF 20', kraft);
    expect(ergebnis).toEqual({ zustand: 'gesendet', daten: antwort });
    const [einsatz, br, gesendet, optionen] = vi.mocked(bucheEintreffen).mock.calls[0];
    expect([einsatz, br, optionen]).toEqual([7, 4, { offlineQueueBenutzerId: 11 }]);
    expect(gesendet).toEqual({ ...kraft, client_id: expect.any(String) });
    expect(gesendet).not.toHaveProperty('zeitpunkt_at');
    expect(await schreibaktionenLaden(11, 7)).toHaveLength(0);
  });

  it('abgerissene Antwort: merkt mit DERSELBEN client_id vor, damit der Server sie wiedererkennt', async () => {
    vi.mocked(bucheEintreffen).mockRejectedValueOnce(new NetzFehler());
    const ergebnis = await erfasseEintreffenOfflineFaehig(11, 7, sportplatz, 'FL', unangemeldet);
    const gesendet = vi.mocked(bucheEintreffen).mock.calls[0][2];
    expect(gesendet.client_id).toEqual(expect.any(String));
    expect(ergebnis).toEqual({ zustand: 'vorgemerkt', client_id: gesendet.client_id });
    const [zeile] = await schreibaktionenLaden(11, 7);
    expect(zeile.aktion.daten).toEqual({ ...gesendet, zeitpunkt_at: '2026-10-16 12:12:00' });
  });

  it('eine fachliche Ablehnung (Raum nicht in Betrieb) wirft und merkt nichts vor', async () => {
    vi.mocked(bucheEintreffen).mockRejectedValueOnce(new ApiError(422, 'BR nicht aktiv'));
    await expect(
      erfasseEintreffenOfflineFaehig(11, 7, sportplatz, 'FL', unangemeldet),
    ).rejects.toMatchObject({ status: 422 });
    expect(await schreibaktionenLaden(11, 7)).toHaveLength(0);
  });
});

describe('offlinefähige Einträge einer Person (LLH-1138, design.md D8)', () => {
  const r012 = { id: 10, bezeichnung: 'R-012' };
  const faelle = [
    {
      art: 'sichtung' as const,
      api: erfasseSichtung,
      eingabe: { kategorie: 'sk1' as const, notiz: null, bestaetigt_personal_id: 5 },
    },
    {
      art: 'verbleib' as const,
      api: erfasseVerbleib,
      eingabe: { art: 'transport' as const, ziel: 'KH Mitte', bestaetigt_personal_id: 5 },
    },
    { art: 'notiz' as const, api: legeNotizAn, eingabe: { text: 'Infusion läuft' } },
    {
      art: 'transport' as const,
      api: saveTransport,
      eingabe: {
        prioritaet: 'dringlich' as const,
        art: 'liegend' as const,
        fachrichtung: null,
        bestaetigt_personal_id: 5,
      },
    },
    {
      art: 'massnahme' as const,
      api: createMassnahme,
      eingabe: { art: 'blutstillung' as const, bestaetigt_personal_id: 5 },
    },
    {
      art: 'verletzung' as const,
      api: createVerletzung,
      eingabe: {
        ansicht: 'vorn' as const,
        region: 'kopf' as const,
        art: 'wunde' as const,
        x: 0.5,
        y: 0.1,
        bestaetigt_personal_id: 5,
      },
    },
  ];

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-18T14:10:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each(faelle)(
    '$art: ohne Netz vorgemerkt mit client_id, Erfassungszeit, Person und „Bestätigt von“',
    async ({ art, api, eingabe }) => {
      online(false);
      const ergebnis = await savePersonEintragOfflineCapable(11, 7, r012, art, {
        ...eingabe,
        client_id: `${art}-1`,
      } as never);
      expect(ergebnis).toEqual({ zustand: 'vorgemerkt', client_id: `${art}-1` });
      expect(api).not.toHaveBeenCalled();
      expect(await schreibaktionenLaden(11, 7)).toEqual([
        expect.objectContaining({
          aktion: {
            art,
            person_id: 10,
            bezeichnung: 'R-012',
            daten: { ...eingabe, client_id: `${art}-1`, zeitpunkt_at: '2026-10-18 14:10:00' },
          },
        }),
      ]);
    },
  );

  it.each(faelle)(
    '$art: online gesendet mit client_id und Queue-Besitzer, ohne Zeitpunkt',
    async ({ art, api, eingabe }) => {
      const antwort = { id: 99 };
      vi.mocked(api).mockResolvedValue(antwort as never);
      const ergebnis = await savePersonEintragOfflineCapable(11, 7, r012, art, eingabe as never);
      expect(ergebnis).toEqual({ zustand: 'gesendet', daten: antwort });
      const [einsatz, person, gesendet, optionen] = vi.mocked(api).mock.calls[0] as unknown[];
      expect([einsatz, person, optionen]).toEqual([7, 10, { offlineQueueBenutzerId: 11 }]);
      expect(gesendet).toEqual({ ...eingabe, client_id: expect.any(String) });
      expect(gesendet).not.toHaveProperty('zeitpunkt_at');
      expect(await schreibaktionenLaden(11, 7)).toHaveLength(0);
    },
  );

  it.each(faelle)(
    '$art: abgerissene Antwort merkt mit DERSELBEN client_id vor, eine fachliche 4xx wirft',
    async ({ art, api, eingabe }) => {
      vi.mocked(api).mockRejectedValueOnce(new NetzFehler());
      const ergebnis = await savePersonEintragOfflineCapable(11, 7, r012, art, eingabe as never);
      const gesendet = vi.mocked(api).mock.calls[0][2] as { client_id: string };
      expect(gesendet.client_id).toEqual(expect.any(String));
      expect(ergebnis).toEqual({ zustand: 'vorgemerkt', client_id: gesendet.client_id });
      const [zeile] = await schreibaktionenLaden(11, 7);
      expect(zeile.aktion).toMatchObject({ art, person_id: 10 });
      expect((zeile.aktion as { daten: unknown }).daten).toEqual({
        ...gesendet,
        zeitpunkt_at: '2026-10-18 14:10:00',
      });

      vi.mocked(api).mockRejectedValueOnce(new ApiError(422, 'Person ist nicht anwesend'));
      await expect(
        savePersonEintragOfflineCapable(11, 7, r012, art, eingabe as never),
      ).rejects.toMatchObject({ status: 422 });
      expect(await schreibaktionenLaden(11, 7)).toHaveLength(1);
    },
  );

  it('lässt die eingetragene Durchführung einer Maßnahme beim Vormerken stehen', async () => {
    online(false);
    await savePersonEintragOfflineCapable(11, 7, r012, 'massnahme', {
      art: 'zugang',
      zeitpunkt_at: '2026-10-18 13:55:00',
    });
    const [zeile] = await schreibaktionenLaden(11, 7);
    expect(zeile.aktion).toMatchObject({
      art: 'massnahme',
      daten: { art: 'zugang', zeitpunkt_at: '2026-10-18 13:55:00' },
    });
  });
});
