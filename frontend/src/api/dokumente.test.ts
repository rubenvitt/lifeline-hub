import { afterEach, describe, expect, it, vi } from 'vitest';
import { installiereXhrAttrappe } from '../test/xhrAttrappe';
import type { UploadFortschritt } from './client';
import { dokumentDownloadPfad, legeDokumentAb } from './dokumente';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('dokumente-API', () => {
  it('schickt Datei und Metadaten in EINEM Multipart', async () => {
    const anfragen = installiereXhrAttrappe();
    const datei = new File(['x'], 'plan.pdf', { type: 'application/pdf' });
    const ergebnis = legeDokumentAb(7, {
      datei,
      titel: 'Plan',
      kategorie: 'lagekarte_plan',
      bezug: { typ: 'abschnitt', id: 3 },
    });
    const [xhr] = anfragen;
    expect(xhr.methode).toBe('POST');
    expect(xhr.url).toBe('/api/einsaetze/7/dokumente');
    const fd = xhr.body as FormData;
    expect(fd.get('datei')).toBe(datei);
    expect(fd.get('titel')).toBe('Plan');
    expect(fd.get('kategorie')).toBe('lagekarte_plan');
    expect(fd.get('bezug_typ')).toBe('abschnitt');
    expect(fd.get('bezug_id')).toBe('3');
    xhr.antworten(201, { id: 1 });
    await expect(ergebnis).resolves.toEqual({ id: 1 });
  });

  it('lässt den Bezug ohne Angabe ganz weg', () => {
    const anfragen = installiereXhrAttrappe();
    void legeDokumentAb(7, { datei: new File(['x'], 'a.pdf'), titel: 'A', kategorie: 'foto' });
    const fd = anfragen[0].body as FormData;
    expect(fd.has('bezug_typ')).toBe(false);
    expect(fd.has('bezug_id')).toBe(false);
  });

  it('baut den Download-Pfad', () => {
    expect(dokumentDownloadPfad(7, 42)).toBe('/api/einsaetze/7/dokumente/42/datei');
  });

  it('nutzt das 120-s-Upload-Timeout, nicht das 15-s-Standard-Timeout', () => {
    const anfragen = installiereXhrAttrappe();
    void legeDokumentAb(7, { datei: new File(['x'], 'a.pdf'), titel: 'A', kategorie: 'foto' });
    expect(anfragen[0].timeout).toBe(120_000);
  });

  it('reicht den Fortschritt an den Aufrufer durch (LFH-654)', () => {
    const anfragen = installiereXhrAttrappe();
    const meldungen: UploadFortschritt[] = [];
    void legeDokumentAb(
      7,
      { datei: new File(['x'], 'a.pdf'), titel: 'A', kategorie: 'foto' },
      (f) => meldungen.push(f),
    );
    anfragen[0].fortschritt(1, 4);
    anfragen[0].uebertragen();
    expect(meldungen).toEqual([{ phase: 'senden', anteil: 0.25 }, { phase: 'pruefen' }]);
  });
});
