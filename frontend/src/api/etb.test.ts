import { afterEach, describe, expect, it, vi } from 'vitest';
import { installiereXhrAttrappe } from '../test/xhrAttrappe';
import { AusgangUnbekannt, NetzFehler, type UploadFortschritt } from './client';
import { etbAnhangPfad, ladeEtbAnhangHoch } from './etb';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('ETB-Anhänge (LFH-117)', () => {
  it('lädt EINE Datei über den ETB-Upload hoch und liefert ihre Anzeige', async () => {
    const anfragen = installiereXhrAttrappe();
    const anzeige = { id: 5, dateiname: 'foto.jpg', mime: 'image/jpeg', groesse: 1 };
    const datei = new File(['x'], 'foto.jpg', { type: 'image/jpeg' });

    const ergebnis = ladeEtbAnhangHoch(7, datei);
    const [xhr] = anfragen;
    expect(xhr.methode).toBe('POST');
    expect(xhr.url).toBe('/api/einsaetze/7/etb/anhaenge');
    const fd = xhr.body as FormData;
    expect(fd.getAll('datei')).toEqual([datei]);
    xhr.antworten(201, [anzeige]);
    await expect(ergebnis).resolves.toEqual(anzeige);
  });

  it('nutzt das 120-s-Upload-Timeout, nicht das 15-s-Standard-Timeout', () => {
    const anfragen = installiereXhrAttrappe();
    void ladeEtbAnhangHoch(7, new File(['x'], 'a.jpg'));
    expect(anfragen[0].timeout).toBe(120_000);
  });

  it('reicht den Fortschritt an den Aufrufer durch (LFH-878)', () => {
    const anfragen = installiereXhrAttrappe();
    const meldungen: UploadFortschritt[] = [];
    void ladeEtbAnhangHoch(7, new File(['x'], 'a.jpg'), (f) => meldungen.push(f));
    anfragen[0].fortschritt(3, 4);
    anfragen[0].uebertragen();
    expect(meldungen).toEqual([{ phase: 'senden', anteil: 0.75 }, { phase: 'pruefen' }]);
  });

  it('Zeitlimit vor dem letzten Byte: NetzFehler, danach AusgangUnbekannt', async () => {
    const anfragen = installiereXhrAttrappe();
    const vorher = ladeEtbAnhangHoch(7, new File(['x'], 'a.jpg'));
    anfragen[0].zeitlimit();
    await expect(vorher).rejects.toBeInstanceOf(NetzFehler);
    await expect(vorher).rejects.not.toBeInstanceOf(AusgangUnbekannt);

    const danach = ladeEtbAnhangHoch(7, new File(['x'], 'a.jpg'));
    anfragen[1].uebertragen();
    anfragen[1].zeitlimit();
    await expect(danach).rejects.toBeInstanceOf(AusgangUnbekannt);
  });

  it('baut den Download-Pfad unter dem ETB-Präfix — nie den generischen', () => {
    expect(etbAnhangPfad(7, 42, 9)).toBe('/api/einsaetze/7/etb/42/anhaenge/9');
    expect(etbAnhangPfad(7, 42, 9)).not.toMatch(/^\/api\/einsaetze\/7\/anhaenge/);
  });
});
