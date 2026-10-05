import { afterEach, describe, expect, it, vi } from 'vitest';
import { installiereXhrAttrappe } from '../test/xhrAttrappe';
import type { UploadFortschritt } from './client';
import {
  entferneTierAnhang,
  legeTierAnhangAb,
  listeTierAnhaenge,
  tierAnhangDownloadPfad,
} from './einsatzTier';
import {
  entferneUhsAnhang,
  ladeUhsAnhangZugriffe,
  legeUhsAnhangAb,
  listeUhsAnhaenge,
  uhsAnhangDownloadPfad,
} from './einsatzUhs';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// LFH-758: Anhänge an Tieren und UHS laufen ausschließlich über die Route ihres Moduls.
const faelle = [
  {
    modul: 'Tier',
    basis: '/api/einsaetze/7/tiere/3/anhaenge',
    liste: listeTierAnhaenge,
    ablegen: legeTierAnhangAb,
    entfernen: entferneTierAnhang,
    downloadPfad: tierAnhangDownloadPfad,
  },
  {
    modul: 'UHS',
    basis: '/api/einsaetze/7/uhs/3/anhaenge',
    liste: listeUhsAnhaenge,
    ablegen: legeUhsAnhangAb,
    entfernen: entferneUhsAnhang,
    downloadPfad: uhsAnhangDownloadPfad,
  },
] as const;

describe.each(faelle)(
  '$modul-Anhänge-API',
  ({ basis, liste, ablegen, entfernen, downloadPfad }) => {
    it('listet über die Modulroute', async () => {
      const fetchMock = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response('[]', { status: 200 }));
      await liste(7, 3);
      expect(fetchMock.mock.calls[0][0]).toBe(basis);
    });

    it('legt EINE Datei im Feld `datei` ab, mit dem 120-s-Upload-Timeout', async () => {
      const anfragen = installiereXhrAttrappe();
      const datei = new File(['x'], 'plan.pdf', { type: 'application/pdf' });
      const ergebnis = ablegen(7, 3, datei);
      const [xhr] = anfragen;
      expect(xhr.url).toBe(basis);
      expect(xhr.methode).toBe('POST');
      const fd = xhr.body as FormData;
      expect(fd.get('datei')).toBe(datei);
      expect([...fd.keys()]).toEqual(['datei']);
      expect(xhr.timeout).toBe(120_000);
      xhr.antworten(201, { id: 1 });
      await expect(ergebnis).resolves.toEqual({ id: 1 });
    });

    it('reicht den Fortschritt an den Aufrufer durch (LFH-878)', () => {
      const anfragen = installiereXhrAttrappe();
      const meldungen: UploadFortschritt[] = [];
      void ablegen(7, 3, new File(['x'], 'plan.pdf'), (f) => meldungen.push(f));
      anfragen[0].fortschritt(1, 4);
      anfragen[0].uebertragen();
      expect(meldungen).toEqual([{ phase: 'senden', anteil: 0.25 }, { phase: 'pruefen' }]);
    });

    it('entfernt per DELETE auf die Linker-id', async () => {
      const fetchMock = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response(null, { status: 204 }));
      await entfernen(7, 3, 42);
      const [pfad, init] = fetchMock.mock.calls[0];
      expect(pfad).toBe(`${basis}/42`);
      expect(init?.method).toBe('DELETE');
    });

    it('baut den Download-Pfad an der Modulroute, nie an /anhaenge des Einsatzes', () => {
      const p = downloadPfad(7, 3, 42);
      expect(p).toBe(`${basis}/42/datei`);
      expect(p.startsWith('/api/einsaetze/7/anhaenge')).toBe(false);
    });
  },
);

describe('UHS-Zugriffsprotokoll-API', () => {
  it('liest das Protokoll unter …/anhaenge/zugriffe', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('[]', { status: 200 }));
    await ladeUhsAnhangZugriffe(7, 3);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/einsaetze/7/uhs/3/anhaenge/zugriffe');
  });
});
