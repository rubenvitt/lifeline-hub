import { afterEach, describe, expect, it, vi } from 'vitest';
import { installiereXhrAttrappe } from '../test/xhrAttrappe';
import { AusgangUnbekannt, NetzFehler, type UploadFortschritt } from './client';
import { heraufstufenZuEtb, ladeAnhaengeHoch } from './chat';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// LFH-700: Anhänge gehen nur mit, wenn die Person sie im Dialog gewählt hat.
describe('heraufstufenZuEtb', () => {
  function sendeMock() {
    return vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ id: 1 }), { status: 200 }));
  }

  it('sendet die gewählten Anhänge als `anhang_ids`', async () => {
    const fetchMock = sendeMock();
    await heraufstufenZuEtb(7, 3, 'meldung', 'Deich', [11, 12]);
    const [pfad, init] = fetchMock.mock.calls[0];
    expect(pfad).toBe('/api/einsaetze/7/chat/nachrichten/3/heraufstufen-etb');
    expect(JSON.parse(String(init?.body))).toEqual({
      typ: 'meldung',
      inhalt: 'Deich',
      anhang_ids: [11, 12],
    });
  });

  it('lässt das Feld ohne Auswahl weg', async () => {
    const fetchMock = sendeMock();
    await heraufstufenZuEtb(7, 3, 'lage', 'Deich', []);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      typ: 'lage',
      inhalt: 'Deich',
    });
  });
});

describe('chat-API: Anhänge hochladen (LFH-1021)', () => {
  it('schickt alle Dateien in EINEM Multipart', async () => {
    const anfragen = installiereXhrAttrappe();
    const a = new File(['a'], 'a.jpg', { type: 'image/jpeg' });
    const b = new File(['b'], 'b.pdf', { type: 'application/pdf' });
    const ergebnis = ladeAnhaengeHoch(7, [a, b]);
    const [xhr] = anfragen;
    expect(xhr.methode).toBe('POST');
    expect(xhr.url).toBe('/api/einsaetze/7/anhaenge');
    expect((xhr.body as FormData).getAll('datei')).toEqual([a, b]);
    xhr.antworten(201, [{ id: 1 }, { id: 2 }]);
    await expect(ergebnis).resolves.toEqual([{ id: 1 }, { id: 2 }]);
  });

  it('nutzt das 120-s-Upload-Timeout, nicht das 15-s-Standard-Timeout', () => {
    const anfragen = installiereXhrAttrappe();
    void ladeAnhaengeHoch(7, [new File(['x'], 'a.jpg')]);
    expect(anfragen[0].timeout).toBe(120_000);
  });

  it('meldet den Fortschritt an den Aufrufer', () => {
    const anfragen = installiereXhrAttrappe();
    const meldungen: UploadFortschritt[] = [];
    void ladeAnhaengeHoch(7, [new File(['x'], 'a.jpg')], (f) => meldungen.push(f));
    anfragen[0].fortschritt(3, 4);
    anfragen[0].uebertragen();
    expect(meldungen).toEqual([{ phase: 'senden', anteil: 0.75 }, { phase: 'pruefen' }]);
  });

  it('Abbruch vor dem letzten Byte: nicht abgeschickt; danach: Ausgang unklar', async () => {
    const anfragen = installiereXhrAttrappe();
    const vorher = ladeAnhaengeHoch(7, [new File(['x'], 'a.jpg')]);
    anfragen[0].zeitlimit();
    await expect(vorher).rejects.toBeInstanceOf(NetzFehler);
    await expect(vorher).rejects.not.toBeInstanceOf(AusgangUnbekannt);

    const nachher = ladeAnhaengeHoch(7, [new File(['x'], 'a.jpg')]);
    anfragen[1].uebertragen();
    anfragen[1].zeitlimit();
    await expect(nachher).rejects.toBeInstanceOf(AusgangUnbekannt);
  });
});
