import { http, HttpResponse, delay } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { server } from '../test/server';
import {
  INHALT_FRIST_MS,
  WORTLAUT_ANFANG_MAX,
  ladeMeldungInhalt,
  meldungInhaltVon,
  wortlautAnfang,
} from './meldungInhalt';

const KELLER =
  'Kellerabgang Mühlbachweg 34: eine schwer verletzte Person geborgen, Transport in die UHS Turnhalle.';

describe('wortlautAnfang', () => {
  it('lässt einen kurzen Wortlaut ganz', () => {
    expect(wortlautAnfang(KELLER)).toBe(KELLER);
  });

  it('faltet Zeilenumbrüche und Leerraum zu einem Leerzeichen', () => {
    expect(wortlautAnfang('  Gasgeruch\n\nim   Keller\t ')).toBe('Gasgeruch im Keller');
  });

  it('kürzt am Wortende auf höchstens 120 Zeichen und hängt „ …“ an', () => {
    const lang = `${KELLER} ${KELLER}`;
    const anfang = wortlautAnfang(lang);
    expect(Array.from(anfang).length).toBeLessThanOrEqual(WORTLAUT_ANFANG_MAX);
    expect(anfang.endsWith(' …')).toBe(true);
    // Am Wortende geschnitten: das letzte Wort vor dem Auslassungszeichen ist ein ganzes Wort
    // des Wortlauts, kein Stumpf.
    const vorne = anfang.slice(0, -2);
    expect(lang.startsWith(vorne)).toBe(true);
    expect(lang[vorne.length]).toMatch(/[\s,.:;]/);
  });

  it('ohne Leerzeichen schneidet es hart, ohne die Grenze zu reißen', () => {
    const anfang = wortlautAnfang('x'.repeat(300));
    expect(Array.from(anfang).length).toBe(WORTLAUT_ANFANG_MAX);
    expect(anfang.endsWith(' …')).toBe(true);
  });

  it('zählt Zeichen, nicht UTF-16-Einheiten', () => {
    const anfang = wortlautAnfang('🚑'.repeat(200));
    expect(Array.from(anfang).length).toBe(WORTLAUT_ANFANG_MAX);
  });
});

describe('meldungInhaltVon', () => {
  it('Sofortmeldung: Titel mit Absender, Anfang und voller Wortlaut', () => {
    expect(
      meldungInhaltVon('sofortmeldung', { absender: ' Rettungsstaffel ', inhalt: KELLER }),
    ).toEqual({ titel: 'Sofortmeldung · Rettungsstaffel', anfang: KELLER, wortlaut: KELLER });
  });

  it('die Eskalation behält ihr Titelwort', () => {
    expect(
      meldungInhaltVon('sofortmeldung_eskaliert', { absender: 'RTW 2', inhalt: 'Lage' })?.titel,
    ).toBe('Bestätigung ausstehend · RTW 2');
  });

  it('ohne Absender bleibt der Titel des Servers, ohne Wortlaut seine Detailzeile', () => {
    expect(meldungInhaltVon('sofortmeldung', { absender: ' ', inhalt: '' })).toEqual({
      titel: null,
      anfang: null,
      wortlaut: null,
    });
  });

  it('andere Arten bekommen keinen Inhalt', () => {
    expect(meldungInhaltVon('auftrag_erteilt', { absender: 'A', inhalt: 'B' })).toBeNull();
  });
});

describe('ladeMeldungInhalt', () => {
  const ereignis = {
    art: 'sofortmeldung' as const,
    bezug_typ: 'meldung' as const,
    bezug_id: 7,
    einsatz_id: 3,
  };

  afterEach(() => vi.useRealTimers());

  it('holt die Meldung einzeln und bildet den Inhalt', async () => {
    server.use(
      http.get('/api/einsaetze/3/meldungen/7', () =>
        HttpResponse.json({ id: 7, absender: 'Rettungsstaffel', inhalt: KELLER }),
      ),
    );
    expect(await ladeMeldungInhalt(ereignis)).toEqual({
      titel: 'Sofortmeldung · Rettungsstaffel',
      anfang: KELLER,
      wortlaut: KELLER,
    });
  });

  it('fragt bei einer anderen Art oder einem anderen Bezug gar nicht', async () => {
    // Ohne Handler schlüge jeder Abruf fehl (`onUnhandledRequest: 'error'`).
    expect(await ladeMeldungInhalt({ ...ereignis, art: 'auftrag_erteilt' })).toBeNull();
    expect(await ladeMeldungInhalt({ ...ereignis, bezug_typ: 'auftrag' })).toBeNull();
  });

  it('ein Fehler des Servers ergibt keinen Inhalt', async () => {
    server.use(
      http.get('/api/einsaetze/3/meldungen/7', () =>
        HttpResponse.json({ error: 'nicht gefunden' }, { status: 404 }),
      ),
    );
    expect(await ladeMeldungInhalt(ereignis)).toBeNull();
  });

  it('wartet höchstens die Frist: ein hängender Abruf hält den Alarm nicht auf', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    server.use(
      http.get('/api/einsaetze/3/meldungen/7', async () => {
        await delay('infinite');
        return HttpResponse.json({});
      }),
    );
    const zusage = ladeMeldungInhalt(ereignis);
    await vi.advanceTimersByTimeAsync(INHALT_FRIST_MS + 10);
    expect(await zusage).toBeNull();
  });
});
