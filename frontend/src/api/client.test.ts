import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { server } from '../test/server';
import { BENUTZER_PRUEFEN } from '../auth/sitzungsEvent';
import { installiereXhrAttrappe } from '../test/xhrAttrappe';
import {
  ApiError,
  AusgangUnbekannt,
  ERWARTETER_BENUTZER_HEADER,
  NetzFehler,
  OFFLINE_QUEUE_BENUTZER_HEADER,
  apiGet,
  apiSend,
  apiUpload,
  apiUploadMitFortschritt,
  fehlerText,
  type UploadFortschritt,
  istKonflikt,
  setzeErwartetenBenutzer,
} from './client';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  setzeErwartetenBenutzer(null);
});

describe('istKonflikt', () => {
  it('erkennt einen 409-ApiError als optimistischen Sperrkonflikt', () => {
    expect(istKonflikt(new ApiError(409, 'geändert'))).toBe(true);
  });
  it('ist false für andere Status und Nicht-ApiError', () => {
    expect(istKonflikt(new ApiError(404, 'weg'))).toBe(false);
    expect(istKonflikt(new ApiError(422, 'ungültig'))).toBe(false);
    expect(istKonflikt(new Error('boom'))).toBe(false);
    expect(istKonflikt(null)).toBe(false);
  });
});

describe('apiGet', () => {
  it('liefert geparstes JSON bei 200', async () => {
    server.use(http.get('/api/ding', () => HttpResponse.json({ wert: 42 })));
    await expect(apiGet<{ wert: number }>('/api/ding')).resolves.toEqual({ wert: 42 });
  });

  it('wirft ApiError mit Server-Meldung bei Fehlerstatus', async () => {
    server.use(
      http.get('/api/ding', () => HttpResponse.json({ error: 'Nicht gefunden' }, { status: 404 })),
    );
    await expect(apiGet('/api/ding')).rejects.toMatchObject({
      name: 'ApiError',
      status: 404,
      message: 'Nicht gefunden',
    });
  });

  it('bricht einen hängenden Fetch nach dem 15-s-Signal als NetzFehler ab', async () => {
    const controller = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((millisekunden) => {
      expect(millisekunden).toBe(15_000);
      return controller.signal;
    });
    vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => {
      const signal = init?.signal;
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    });

    const anfrage = apiGet('/api/haengt');
    controller.abort(new DOMException('Zeitüberschreitung', 'TimeoutError'));

    await expect(anfrage).rejects.toBeInstanceOf(NetzFehler);
  });

  it('ordnet auch einen expliziten AbortError als NetzFehler ein', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      new DOMException('Verbindung abgebrochen', 'AbortError'),
    );
    await expect(apiGet('/api/abgebrochen')).rejects.toBeInstanceOf(NetzFehler);
  });
});

describe('apiSend', () => {
  it('serialisiert den Body und liefert die Antwort', async () => {
    server.use(
      http.post('/api/ding', async ({ request }) => {
        const body = (await request.json()) as { name: string };
        return HttpResponse.json({ gruss: `Hallo ${body.name}` }, { status: 201 });
      }),
    );
    await expect(apiSend('/api/ding', 'POST', { name: 'Welt' })).resolves.toEqual({
      gruss: 'Hallo Welt',
    });
  });

  it('sendet die optionale erwartete Queue-Eigentümer-ID als eigenen Header', async () => {
    let header: string | null = null;
    server.use(
      http.post('/api/offline-ding', ({ request }) => {
        header = request.headers.get(OFFLINE_QUEUE_BENUTZER_HEADER);
        return HttpResponse.json({ gespeichert: true }, { status: 201 });
      }),
    );

    await apiSend(
      '/api/offline-ding',
      'POST',
      { name: 'Welt' },
      {
        offlineQueueBenutzerId: 17,
      },
    );

    expect(header).toBe('17');
  });

  it('liefert undefined bei 204 ohne Body', async () => {
    server.use(http.post('/api/logout', () => new HttpResponse(null, { status: 204 })));
    await expect(apiSend('/api/logout', 'POST')).resolves.toBeUndefined();
  });

  it('liefert undefined bei 201 ohne Body (z.B. WebAuthn-Finish-Endpunkte, LFH-275)', async () => {
    server.use(http.post('/api/ding', () => new HttpResponse(null, { status: 201 })));
    await expect(apiSend('/api/ding', 'POST', {})).resolves.toBeUndefined();
  });

  it('bündelt TypeError und liefert den eindeutigen Bedienhinweis', async () => {
    server.use(http.post('/api/ding', () => HttpResponse.error()));
    const fehler = await apiSend('/api/ding', 'POST', {}).catch((e) => e);
    expect(fehler).toBeInstanceOf(NetzFehler);
    expect(fehlerText(fehler)).toBe('Keine Verbindung — die Aktion wurde NICHT abgeschickt');
  });

  it('lässt eine 409-Antwort unverändert als optimistischen Sperrkonflikt erkennen', async () => {
    server.use(
      http.post('/api/ding', () =>
        HttpResponse.json({ error: 'Zwischenzeitlich geändert' }, { status: 409 }),
      ),
    );
    const fehler = await apiSend('/api/ding', 'POST', {}).catch((e) => e);
    expect(istKonflikt(fehler)).toBe(true);
  });
});

describe('apiUpload', () => {
  it('nutzt ohne Option das 15-s-Standard-Timeout', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(new AbortController().signal);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    await apiUpload('/api/upload', new FormData());
    expect(timeout).toHaveBeenCalledWith(15_000);
  });

  it('übergibt ein explizites Timeout unverändert', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(new AbortController().signal);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    await apiUpload('/api/upload', new FormData(), { timeoutMs: 120_000 });
    expect(timeout).toHaveBeenCalledWith(120_000);
  });
});

/** LFH-387: der Tab nennt bei jeder schreibenden Anfrage den Benutzer, den er anzeigt; der
 *  Server lehnt mit 412 ab, wenn die originweite Sitzung inzwischen jemand anderem gehört. */
describe('erwarteter Benutzer (LFH-387)', () => {
  function kopfMitschneiden(methode: 'get' | 'post' | 'put' | 'patch' | 'delete') {
    const gesehen: { wert: string | null | undefined } = { wert: undefined };
    server.use(
      http[methode]('/api/ding', ({ request }) => {
        gesehen.wert = request.headers.get(ERWARTETER_BENUTZER_HEADER);
        return HttpResponse.json({ ok: true });
      }),
    );
    return gesehen;
  }

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'] as const)(
    'setzt den Kopf an %s, sobald ein Benutzer gesetzt ist',
    async (methode) => {
      const gesehen = kopfMitschneiden(methode.toLowerCase() as 'post');
      setzeErwartetenBenutzer(7);
      await apiSend('/api/ding', methode, { a: 1 });
      expect(gesehen.wert).toBe('7');
    },
  );

  it('setzt keinen Kopf ohne gesetzten Benutzer', async () => {
    const gesehen = kopfMitschneiden('post');
    await apiSend('/api/ding', 'POST', { a: 1 });
    expect(gesehen.wert).toBeNull();
  });

  it('setzt keinen Kopf mehr, nachdem der Benutzer entfernt wurde', async () => {
    const gesehen = kopfMitschneiden('post');
    setzeErwartetenBenutzer(7);
    setzeErwartetenBenutzer(null);
    await apiSend('/api/ding', 'POST', { a: 1 });
    expect(gesehen.wert).toBeNull();
  });

  it('bindet lesende Anfragen nicht (apiGet und apiSend mit GET)', async () => {
    const gesehen = kopfMitschneiden('get');
    setzeErwartetenBenutzer(7);
    await apiGet('/api/ding');
    expect(gesehen.wert).toBeNull();
    await apiSend('/api/ding', 'GET');
    expect(gesehen.wert).toBeNull();
  });

  it('setzt den Kopf auch am Upload', async () => {
    let wert: string | null = null;
    server.use(
      http.post('/api/upload', ({ request }) => {
        wert = request.headers.get(ERWARTETER_BENUTZER_HEADER);
        return HttpResponse.json({ ok: true });
      }),
    );
    setzeErwartetenBenutzer(7);
    await apiUpload('/api/upload', new FormData());
    expect(wert).toBe('7');
  });

  it('löst bei 412 eine Benutzerprüfung aus und wirft den ApiError unverändert', async () => {
    server.use(
      http.post('/api/ding', () =>
        HttpResponse.json(
          { error: 'Die Sitzung gehört inzwischen einem anderen Benutzer' },
          {
            status: 412,
          },
        ),
      ),
    );
    const pruefen = vi.fn();
    window.addEventListener(BENUTZER_PRUEFEN, pruefen);
    try {
      setzeErwartetenBenutzer(7);
      await expect(apiSend('/api/ding', 'POST', {})).rejects.toMatchObject({ status: 412 });
      expect(pruefen).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener(BENUTZER_PRUEFEN, pruefen);
    }
  });

  it.each([401, 409, 422])('löst bei %i keine Benutzerprüfung aus', async (status) => {
    server.use(http.post('/api/ding', () => HttpResponse.json({ error: 'x' }, { status })));
    const pruefen = vi.fn();
    window.addEventListener(BENUTZER_PRUEFEN, pruefen);
    try {
      await expect(apiSend('/api/ding', 'POST', {})).rejects.toMatchObject({ status });
      expect(pruefen).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener(BENUTZER_PRUEFEN, pruefen);
    }
  });
});

describe('ApiError — wer hat geantwortet? (LFH-723, Review Befund 4)', () => {
  it('kennzeichnet eine Antwort mit dem {error}-Umschlag des eigenen Servers', async () => {
    server.use(
      http.get('/api/umschlag', () =>
        HttpResponse.json({ error: 'Dienst vorübergehend ausgelastet' }, { status: 503 }),
      ),
      http.get('/api/gateway', () => new HttpResponse('<html>Bad Gateway</html>', { status: 502 })),
    );
    const eigen = await apiGet('/api/umschlag').catch((e: unknown) => e);
    expect(eigen).toBeInstanceOf(ApiError);
    expect((eigen as ApiError).vomAnwendungsserver).toBe(true);
    const gateway = await apiGet('/api/gateway').catch((e: unknown) => e);
    expect((gateway as ApiError).vomAnwendungsserver).toBe(false);
  });
});

/** LFH-654: Upload mit Byte-Fortschritt über `XMLHttpRequest`, Fehlerformat wie `apiUpload`. */
describe('apiUploadMitFortschritt (LFH-654)', () => {
  function starte(optionen: { timeoutMs?: number } = {}) {
    const anfragen = installiereXhrAttrappe();
    const meldungen: UploadFortschritt[] = [];
    const fd = new FormData();
    fd.append('titel', 'Plan');
    const ergebnis = apiUploadMitFortschritt<{ id: number }>('/api/upload', fd, {
      ...optionen,
      onFortschritt: (f) => meldungen.push(f),
    });
    // Ein abgelehntes Versprechen darf vor dem `expect` nicht als unbehandelt gelten.
    ergebnis.catch(() => undefined);
    const xhr = anfragen[0];
    return { xhr, fd, meldungen, ergebnis };
  }

  it('sendet POST mit Formular, Cookie und 15-s-Standardzeitlimit', () => {
    const { xhr, fd } = starte();
    expect(xhr.methode).toBe('POST');
    expect(xhr.url).toBe('/api/upload');
    expect(xhr.body).toBe(fd);
    expect(xhr.withCredentials).toBe(true);
    expect(xhr.timeout).toBe(15_000);
  });

  it('übernimmt ein explizites Zeitlimit', () => {
    expect(starte({ timeoutMs: 120_000 }).xhr.timeout).toBe(120_000);
  });

  it('setzt den Kopf des erwarteten Benutzers (LFH-387)', () => {
    setzeErwartetenBenutzer(7);
    expect(starte().xhr.koepfe[ERWARTETER_BENUTZER_HEADER]).toBe('7');
  });

  it('meldet den Anteil aus den Bytes, dann die Prüfphase, und liefert das JSON', async () => {
    const { xhr, meldungen, ergebnis } = starte();
    xhr.fortschritt(5, 20);
    xhr.fortschritt(20, 20);
    xhr.uebertragen();
    xhr.antworten(201, { id: 4 });
    await expect(ergebnis).resolves.toEqual({ id: 4 });
    expect(meldungen).toEqual([
      { phase: 'senden', anteil: 0.25 },
      { phase: 'senden', anteil: 1 },
      { phase: 'pruefen' },
    ]);
  });

  it('meldet anteil null, wenn der Browser die Gesamtgröße nicht kennt', () => {
    const { xhr, meldungen } = starte();
    xhr.fortschritt(5, 0, false);
    expect(meldungen).toEqual([{ phase: 'senden', anteil: null }]);
  });

  it('wirft ApiError mit der Servermeldung und kennzeichnet den eigenen Server', async () => {
    const { xhr, ergebnis } = starte();
    xhr.uebertragen();
    xhr.antworten(400, { error: 'Dateityp nicht erlaubt' });
    const e = await ergebnis.catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect(e).toMatchObject({ status: 400, message: 'Dateityp nicht erlaubt' });
    expect((e as ApiError).vomAnwendungsserver).toBe(true);
  });

  it('löst bei 412 die Benutzerprüfung aus wie jeder Schreibweg', async () => {
    const pruefen = vi.fn();
    window.addEventListener(BENUTZER_PRUEFEN, pruefen);
    try {
      const { xhr, ergebnis } = starte();
      xhr.antworten(412, { error: 'fremde Sitzung' });
      await expect(ergebnis).rejects.toMatchObject({ status: 412 });
      expect(pruefen).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener(BENUTZER_PRUEFEN, pruefen);
    }
  });

  it('nennt eine Gateway-Seite ohne Umschlag nicht den eigenen Server', async () => {
    const { xhr, ergebnis } = starte();
    xhr.antworten(502, '<html>Bad Gateway</html>');
    const e = (await ergebnis.catch((x: unknown) => x)) as ApiError;
    expect(e.status).toBe(502);
    expect(e.vomAnwendungsserver).toBe(false);
  });

  it('wirft NetzFehler, wenn die Leitung VOR dem letzten Byte abreißt', async () => {
    const { xhr, ergebnis } = starte();
    xhr.fortschritt(12, 20);
    xhr.netzfehler();
    const e = await ergebnis.catch((x: unknown) => x);
    expect(e).toBeInstanceOf(NetzFehler);
    expect(e).not.toBeInstanceOf(AusgangUnbekannt);
  });

  it('wirft NetzFehler bei Zeitlimit VOR dem letzten Byte', async () => {
    const { xhr, ergebnis } = starte();
    xhr.zeitlimit();
    const e = await ergebnis.catch((x: unknown) => x);
    expect(e).toBeInstanceOf(NetzFehler);
    expect(e).not.toBeInstanceOf(AusgangUnbekannt);
  });

  it.each(['zeitlimit', 'netzfehler'] as const)(
    'wirft AusgangUnbekannt bei %s NACH dem letzten Byte',
    async (art) => {
      const { xhr, ergebnis } = starte();
      xhr.uebertragen();
      xhr[art]();
      await expect(ergebnis).rejects.toBeInstanceOf(AusgangUnbekannt);
    },
  );
});

describe('AusgangUnbekannt (LFH-654)', () => {
  it('bleibt ein NetzFehler, trägt aber einen eigenen Text', () => {
    const e = new AusgangUnbekannt();
    expect(e).toBeInstanceOf(NetzFehler);
    expect(fehlerText(e)).toMatch(/unklar/);
    expect(fehlerText(e)).toMatch(/Liste/);
    expect(fehlerText(e)).not.toMatch(/NICHT abgeschickt/);
  });

  it('lässt den Text des gewöhnlichen NetzFehlers unverändert', () => {
    expect(fehlerText(new NetzFehler())).toBe(
      'Keine Verbindung — die Aktion wurde NICHT abgeschickt',
    );
  });
});
