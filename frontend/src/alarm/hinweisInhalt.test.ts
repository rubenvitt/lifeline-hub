import { QueryClient } from '@tanstack/react-query';
import { delay, http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { einsatzKeys } from '../api/queryKeys';
import type { BenachrichtigungArt, BenachrichtigungBezugTyp } from '../api/types';
import { server } from '../test/server';
import { ladeHinweisInhalt, titelMit, type HinweisInhalt } from './hinweisInhalt';
import { INHALT_FRIST_MS } from './meldungInhalt';

/**
 * Der Gegenstand eines Hinweises (LLH-1909, Fortsetzung von LLH-1052/LLH-1737): Auftrag, Befehl,
 * Lagebericht, Gefahr, Nachforderung und Chat nennen ihn wie Meldung und Erinnerung, geholt über
 * die vorhandenen Abrufe des Clients.
 */

function quelle(art: BenachrichtigungArt, bezug_typ: BenachrichtigungBezugTyp, bezug_id: number) {
  return { art, bezug_typ, bezug_id, einsatz_id: 1 };
}

const AUFTRAGSTEXT = 'Wasserentnahme an der Mühlbachbrücke einrichten und melden';

function auftragServer() {
  const abrufe = { anzahl: 0 };
  server.use(
    http.get('/api/einsaetze/:id/auftraege/:aid', ({ params }) => {
      abrufe.anzahl += 1;
      return HttpResponse.json({
        id: Number(params.aid),
        lfd_nr: 12,
        auftrag_text: AUFTRAGSTEXT,
        empfaenger: [
          { id: 40, auftrag_id: Number(params.aid), snap_anzeige: 'S4 Versorgung' },
          { id: 41, auftrag_id: Number(params.aid), snap_anzeige: 'RTW 2' },
        ],
      });
    }),
  );
  return abrufe;
}

afterEach(() => vi.useRealTimers());

describe('titelMit', () => {
  const leer: HinweisInhalt = {
    titel: null,
    gegenstand: null,
    wer: null,
    anfang: null,
    wortlaut: null,
    absender: null,
    status: null,
  };

  it('ohne Inhalt bleibt der Titel des Servers', () => {
    expect(titelMit('Neuer Befehl', null)).toBe('Neuer Befehl');
    expect(titelMit('Neuer Befehl', leer)).toBe('Neuer Befehl');
  });

  it('der Gegenstand steht hinter einem Doppelpunkt', () => {
    expect(titelMit('Neuer Befehl', { ...leer, gegenstand: 'Räumung Nord' })).toBe(
      'Neuer Befehl: Räumung Nord',
    );
  });

  it('wer steht hinter einem Mittelpunkt', () => {
    expect(titelMit('Erwähnt im Chat', { ...leer, wer: 'Anna Berg' })).toBe(
      'Erwähnt im Chat · Anna Berg',
    );
  });

  it('ein ganzer Titel ersetzt den des Servers', () => {
    expect(titelMit('Neue Meldung', { ...leer, titel: 'Neue Meldung · RTW 2' })).toBe(
      'Neue Meldung · RTW 2',
    );
  });
});

describe('ladeHinweisInhalt', () => {
  it('Auftrag: Nummer und Anfang des Auftragstexts, der ganze Text im Wortlaut', async () => {
    auftragServer();
    const inhalt = await ladeHinweisInhalt(quelle('auftrag_erteilt', 'auftrag', 5));
    expect(inhalt?.anfang).toBe(`#12 · ${AUFTRAGSTEXT}`);
    expect(inhalt?.wortlaut).toBe(AUFTRAGSTEXT);
    expect(inhalt?.wer).toBeNull();
    expect(inhalt?.gegenstand).toBeNull();
  });

  it.each(['auftrag_erledigt', 'auftrag_ueberfaellig'] as const)(
    '%s nennt den Auftragstext ebenso',
    async (art) => {
      auftragServer();
      expect((await ladeHinweisInhalt(quelle(art, 'auftrag', 5)))?.anfang).toBe(
        `#12 · ${AUFTRAGSTEXT}`,
      );
    },
  );

  it('Auftrag quittiert: den Auftrag aus dem Sprungpfad, wer quittiert hat aus seiner Zeile', async () => {
    auftragServer();
    const inhalt = await ladeHinweisInhalt(quelle('auftrag_quittiert', 'auftrag_empfaenger', 41), {
      pfad: Promise.resolve('/einsaetze/1/auftraege?auftrag=5'),
    });
    expect(inhalt?.wer).toBe('RTW 2');
    expect(inhalt?.anfang).toBe(`#12 · ${AUFTRAGSTEXT}`);
  });

  it('Auftrag quittiert ohne Sprungpfad: kein Abruf, kein Inhalt', async () => {
    const abrufe = auftragServer();
    expect(
      await ladeHinweisInhalt(quelle('auftrag_quittiert', 'auftrag_empfaenger', 41)),
    ).toBeNull();
    expect(abrufe.anzahl).toBe(0);
  });

  it('ein Auftrag im Cache antwortet ohne Abruf', async () => {
    const abrufe = auftragServer();
    const qc = new QueryClient();
    qc.setQueryData(einsatzKeys.auftragEinzeln(1, 5), {
      id: 5,
      lfd_nr: 3,
      auftrag_text: 'Funkcheck',
      empfaenger: [],
    });
    const inhalt = await ladeHinweisInhalt(quelle('auftrag_erteilt', 'auftrag', 5), { qc });
    expect(inhalt?.anfang).toBe('#3 · Funkcheck');
    expect(abrufe.anzahl).toBe(0);
  });

  it('Befehl und Lagebericht: der Dokumenttitel als Gegenstand', async () => {
    server.use(
      http.get('/api/einsaetze/:id/befehle/:bid', () =>
        HttpResponse.json({ id: 7, titel: ' Räumung Nord ' }),
      ),
      http.get('/api/einsaetze/:id/lageberichte/:lid', () =>
        HttpResponse.json({ id: 8, titel: 'Lage 14 Uhr' }),
      ),
    );
    expect((await ladeHinweisInhalt(quelle('befehl', 'befehl', 7)))?.gegenstand).toBe(
      'Räumung Nord',
    );
    expect((await ladeHinweisInhalt(quelle('lagebericht', 'lagebericht', 8)))?.gegenstand).toBe(
      'Lage 14 Uhr',
    );
  });

  it('Gefahr: die Bezeichnung aus den Zonen der Lagekarte', async () => {
    server.use(
      http.get('/api/einsaetze/:id/zones', () =>
        HttpResponse.json([
          { id: 1, gefahrengebiet_id: null, label: 'Bereitstellung' },
          { id: 2, gefahrengebiet_id: 9, label: 'Gasaustritt Halle 3' },
        ]),
      ),
    );
    expect((await ladeHinweisInhalt(quelle('gefahr', 'gefahrengebiet', 9)))?.gegenstand).toBe(
      'Gasaustritt Halle 3',
    );
  });

  it('Gefahr ohne Bezeichnung: kein Inhalt', async () => {
    server.use(
      http.get('/api/einsaetze/:id/zones', () =>
        HttpResponse.json([{ id: 2, gefahrengebiet_id: 9, label: null }]),
      ),
    );
    expect(await ladeHinweisInhalt(quelle('gefahr', 'gefahrengebiet', 9))).toBeNull();
  });

  it('Nachforderung: Art und Bezeichnung ohne Anzahl (die nennt schon die Detailzeile)', async () => {
    server.use(
      http.get('/api/einsaetze/:id/nachforderungen', () =>
        HttpResponse.json([
          { id: 3, anzahl: 2, art: 'RTW', bezeichnung: 'Transport aus der UHS' },
          { id: 4, anzahl: 1, art: 'ELW 1', bezeichnung: null },
        ]),
      ),
    );
    expect(
      (await ladeHinweisInhalt(quelle('nachforderung_status', 'nachforderung_zugesagt', 3)))
        ?.gegenstand,
    ).toBe('RTW — Transport aus der UHS');
    expect(
      (await ladeHinweisInhalt(quelle('nachforderung_status', 'nachforderung_eingetroffen', 4)))
        ?.gegenstand,
    ).toBe('ELW 1');
  });

  it('Chat: Absender und Anfang des Texts, die Nachricht über den Kanal aus dem Sprungpfad', async () => {
    let gefragt: string | null = null;
    server.use(
      http.get('/api/einsaetze/:id/chat/kanaele/:kid/nachrichten', ({ params, request }) => {
        gefragt = `${String(params.kid)}?${new URL(request.url).searchParams.toString()}`;
        return HttpResponse.json([
          { id: 20, kanal_id: 6, autor_name: 'Anna Berg', inhalt: '@S4 bitte Feldbetten zählen' },
          { id: 19, kanal_id: 6, autor_name: 'Ben Kurz', inhalt: 'älter' },
        ]);
      }),
    );
    const inhalt = await ladeHinweisInhalt(quelle('chat_erwaehnung', 'chat_nachricht', 20), {
      pfad: '/einsaetze/1/chat?kanal=6',
    });
    expect(gefragt).toBe('6?before_id=21');
    expect(inhalt?.wer).toBe('Anna Berg');
    expect(inhalt?.anfang).toBe('@S4 bitte Feldbetten zählen');
    expect(inhalt?.wortlaut).toBe('@S4 bitte Feldbetten zählen');
  });

  it('Chat: eine gelöschte Nachricht nennt nur den Absender', async () => {
    server.use(
      http.get('/api/einsaetze/:id/chat/kanaele/:kid/nachrichten', () =>
        HttpResponse.json([
          {
            id: 20,
            kanal_id: 6,
            autor_name: 'Anna Berg',
            inhalt: null,
            geloescht_at: '2026-11-22 10:00:00',
          },
        ]),
      ),
    );
    const inhalt = await ladeHinweisInhalt(quelle('chat_erwaehnung', 'chat_nachricht', 20), {
      pfad: '/einsaetze/1/chat?kanal=6',
    });
    expect(inhalt?.wer).toBe('Anna Berg');
    expect(inhalt?.anfang).toBeNull();
  });

  it('Meldung und Erinnerung laufen über denselben Lader', async () => {
    server.use(
      http.get('/api/einsaetze/:id/meldungen/:mid', () =>
        HttpResponse.json({ id: 77, absender: 'RTW 2', inhalt: 'Lage stabil', status: 'neu' }),
      ),
      http.get('/api/einsaetze/:id/erinnerungen', () =>
        HttpResponse.json([{ id: 5, einsatz_id: 1, titel: 'Pegel prüfen' }]),
      ),
    );
    const meldung = await ladeHinweisInhalt(quelle('sofortmeldung', 'meldung', 77));
    expect(meldung?.titel).toBe('Sofortmeldung · RTW 2');
    expect(meldung?.absender).toBe('RTW 2');
    expect(meldung?.status).toBe('neu');
    expect(
      (await ladeHinweisInhalt(quelle('erinnerung_faellig', 'erinnerung', 5)))?.gegenstand,
    ).toBe('Pegel prüfen');
  });

  it('eine Art ohne Gegenstand fragt nicht nach', async () => {
    expect(await ladeHinweisInhalt(quelle('abloesung_faellig', 'abloesung', 3))).toBeNull();
  });

  it('ein Fehler ergibt null', async () => {
    server.use(
      http.get('/api/einsaetze/:id/befehle/:bid', () =>
        HttpResponse.json({ error: 'weg' }, { status: 404 }),
      ),
    );
    expect(await ladeHinweisInhalt(quelle('befehl', 'befehl', 7))).toBeNull();
  });

  it(`antwortet der Abruf nicht in ${INHALT_FRIST_MS} ms, ergibt er null`, async () => {
    server.use(
      http.get('/api/einsaetze/:id/befehle/:bid', async () => {
        await delay('infinite');
        return HttpResponse.json({});
      }),
    );
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const zusage = ladeHinweisInhalt(quelle('befehl', 'befehl', 7));
    await vi.advanceTimersByTimeAsync(INHALT_FRIST_MS);
    expect(await zusage).toBeNull();
  });
});
