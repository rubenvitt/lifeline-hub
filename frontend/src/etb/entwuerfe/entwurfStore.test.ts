import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EtbEntwurf } from './entwurfModell';
import {
  entwuerfeLaden,
  entwuerfeLeerenFuerTests,
  entwurfEntfernen,
  entwurfSpeichern,
} from './entwurfStore';

function entwurf(over: Partial<EtbEntwurf> = {}): EtbEntwurf {
  return {
    id: 'a',
    einsatz_id: 7,
    inhalt: 'X',
    typ: 'meldung',
    erstellt_at: '2026-06-22T10:00:00.000Z',
    geaendert_at: '2026-06-22T10:00:00.000Z',
    ...over,
  };
}

beforeEach(async () => {
  await entwuerfeLeerenFuerTests();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * Das Neuladen bricht eine noch offene IndexedDB-Transaktion ab (LFH-521). Nachgestellt wird
 * genau das: der Schreibauftrag ist erteilt, die Transaktion kommt aber nie zum Abschluss.
 * Danach steht die Seite neu auf — hier der nächste `entwuerfeLaden` nach `mockRestore`.
 */
function schreibenBrichtAb() {
  const put = IDBObjectStore.prototype.put;
  const loeschen = IDBObjectStore.prototype.delete;
  const abbrechen = (store: IDBObjectStore) => store.transaction.abort();
  return [
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
      this: IDBObjectStore,
      ...args: Parameters<IDBObjectStore['put']>
    ) {
      const anfrage = put.apply(this, args);
      abbrechen(this);
      return anfrage;
    }),
    vi.spyOn(IDBObjectStore.prototype, 'delete').mockImplementation(function (
      this: IDBObjectStore,
      ...args: Parameters<IDBObjectStore['delete']>
    ) {
      const anfrage = loeschen.apply(this, args);
      abbrechen(this);
      return anfrage;
    }),
  ];
}

function neuStarten(spione: { mockRestore: () => void }[]) {
  for (const s of spione) s.mockRestore();
}

describe('entwurfStore', () => {
  it('speichert und lädt Entwürfe gescopet pro Einsatz, sortiert nach erstellt_at', async () => {
    await entwurfSpeichern(entwurf({ id: 'b', erstellt_at: '2026-06-22T11:00:00.000Z' }));
    await entwurfSpeichern(entwurf({ id: 'a', erstellt_at: '2026-06-22T10:00:00.000Z' }));
    await entwurfSpeichern(entwurf({ id: 'c', einsatz_id: 99 }));

    const liste = await entwuerfeLaden(7);
    expect(liste.map((e) => e.id)).toEqual(['a', 'b']); // c gehört zu Einsatz 99
  });

  it('put aktualisiert einen bestehenden Entwurf (gleiche id)', async () => {
    await entwurfSpeichern(entwurf({ id: 'a', inhalt: 'alt' }));
    await entwurfSpeichern(entwurf({ id: 'a', inhalt: 'neu' }));
    const liste = await entwuerfeLaden(7);
    expect(liste).toHaveLength(1);
    expect(liste[0].inhalt).toBe('neu');
  });

  it('entfernt einen Entwurf', async () => {
    await entwurfSpeichern(entwurf({ id: 'a' }));
    await entwurfEntfernen('a');
    expect(await entwuerfeLaden(7)).toHaveLength(0);
  });

  describe('LFH-521: ausstehende Speicherung beim Neuladen', () => {
    it('ein Entwurf, dessen Transaktion abbricht, steht nach dem Neuladen wieder da', async () => {
      const spione = schreibenBrichtAb();
      await entwurfSpeichern(entwurf({ id: 'a', inhalt: 'Angefangen' })).catch(() => {});
      neuStarten(spione);

      const liste = await entwuerfeLaden(7);
      expect(liste.map((e) => e.inhalt)).toEqual(['Angefangen']);
    });

    it('die letzte Fassung gewinnt, auch wenn nur die erste die Platte erreicht hat', async () => {
      await entwurfSpeichern(entwurf({ id: 'a', inhalt: 'Ang' }));
      const spione = schreibenBrichtAb();
      await entwurfSpeichern(
        entwurf({ id: 'a', inhalt: 'Angefangen', geaendert_at: '2026-06-22T10:00:05.000Z' }),
      ).catch(() => {});
      neuStarten(spione);

      expect((await entwuerfeLaden(7)).map((e) => e.inhalt)).toEqual(['Angefangen']);
    });

    it('die Persistenzgrenze liegt am Aufruf: schon vor dem ersten await ist der Entwurf gesichert', async () => {
      const spione = schreibenBrichtAb();
      // Kein await: die Seite lädt neu, noch bevor die IndexedDB auch nur geöffnet ist.
      const laufend = entwurfSpeichern(entwurf({ id: 'a', inhalt: 'Sofort' }));
      const vorlauf = { ...localStorage };
      await laufend.catch(() => {});
      neuStarten(spione);
      localStorage.clear();
      for (const [k, v] of Object.entries(vorlauf)) localStorage.setItem(k, v);

      expect((await entwuerfeLaden(7)).map((e) => e.inhalt)).toEqual(['Sofort']);
    });

    it('ein früher Abschluss streicht keinen jüngeren Auftrag desselben Entwurfs', async () => {
      // Zwei Tastenanschläge kurz hintereinander: der erste Schreibvorgang gelingt, der zweite
      // wird vom Neuladen abgebrochen. Die Quittung des ersten darf den Vorlauf des zweiten
      // nicht streichen.
      const put = IDBObjectStore.prototype.put;
      let aufruf = 0;
      const spion = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
        this: IDBObjectStore,
        ...args: Parameters<IDBObjectStore['put']>
      ) {
        const anfrage = put.apply(this, args);
        if (++aufruf === 2) this.transaction.abort();
        return anfrage;
      });
      const erster = entwurfSpeichern(entwurf({ id: 'a', inhalt: 'Ang' }));
      // Der Handler hängt sofort: der zweite Schreibvorgang scheitert, bevor der erste endet.
      const zweiter = entwurfSpeichern(
        entwurf({ id: 'a', inhalt: 'Angefangen', geaendert_at: '2026-06-22T10:00:05.000Z' }),
      ).catch(() => {});
      await erster;
      await zweiter;
      spion.mockRestore();

      expect((await entwuerfeLaden(7)).map((e) => e.inhalt)).toEqual(['Angefangen']);
    });

    it('ein Entfernen, dessen Transaktion abbricht, holt den Entwurf nicht zurück', async () => {
      await entwurfSpeichern(entwurf({ id: 'a' }));
      const spione = schreibenBrichtAb();
      await entwurfEntfernen('a').catch(() => {});
      neuStarten(spione);

      expect(await entwuerfeLaden(7)).toHaveLength(0);
    });

    it('nach dem Nachtragen liegt der Entwurf auf der Platte, nicht mehr nur im Vorlauf', async () => {
      const spione = schreibenBrichtAb();
      await entwurfSpeichern(entwurf({ id: 'a', inhalt: 'Angefangen' })).catch(() => {});
      neuStarten(spione);
      await entwuerfeLaden(7);

      // Ohne Vorlauf (anderes Gerät, geleerter Browserspeicher) bleibt er trotzdem.
      localStorage.clear();
      expect((await entwuerfeLaden(7)).map((e) => e.inhalt)).toEqual(['Angefangen']);
    });

    it('ein gelungenes Speichern hinterlässt keinen Vorlauf', async () => {
      await entwurfSpeichern(entwurf({ id: 'a' }));
      expect(localStorage.length).toBe(0);
    });

    it('ein gelungenes Entfernen hinterlässt keinen Vorlauf', async () => {
      await entwurfEntfernen('a');
      expect(localStorage.length).toBe(0);
    });

    it('ein beschädigter Vorlauf sperrt das Laden nicht', async () => {
      await entwurfSpeichern(entwurf({ id: 'a', inhalt: 'Bestand' }));
      localStorage.setItem(
        'lifeline-etb-entwuerfe-ausstehend:kaputt',
        JSON.stringify({ stand: 's', entwurf: { inhalt: 'ohne id' } }),
      );
      vi.spyOn(console, 'warn').mockImplementation(() => {});

      expect((await entwuerfeLaden(7)).map((e) => e.inhalt)).toEqual(['Bestand']);
    });

    it('jeder Entwurf hat seinen eigenen Vorlauf — ein zweiter Tab schreibt keinen fremden zurück', async () => {
      const spione = schreibenBrichtAb();
      await entwurfSpeichern(entwurf({ id: 'x', inhalt: 'X' })).catch(() => {});
      await entwurfSpeichern(entwurf({ id: 'y', inhalt: 'Y' })).catch(() => {});
      neuStarten(spione);

      expect(Object.keys(localStorage).sort()).toEqual([
        'lifeline-etb-entwuerfe-ausstehend:x',
        'lifeline-etb-entwuerfe-ausstehend:y',
      ]);
      // Tab A sendet X und entfernt ihn; Tab B speichert Y — ohne X je anzufassen.
      await entwurfEntfernen('x');
      await entwurfSpeichern(entwurf({ id: 'y', inhalt: 'Y2' }));
      expect((await entwuerfeLaden(7)).map((e) => e.inhalt)).toEqual(['Y2']);
    });

    it('ein älterer Vorlauf überschreibt keine jüngere Fassung auf der Platte', async () => {
      const spione = schreibenBrichtAb();
      await entwurfSpeichern(entwurf({ id: 'a', inhalt: 'alt' })).catch(() => {});
      neuStarten(spione);
      // Ein zweiter Tab hat inzwischen eine jüngere Fassung geschrieben — ohne diesen Vorlauf.
      const vorlauf = { ...localStorage };
      await entwurfSpeichern(
        entwurf({ id: 'a', inhalt: 'jung', geaendert_at: '2026-06-22T11:00:00.000Z' }),
      );
      for (const [k, v] of Object.entries(vorlauf)) localStorage.setItem(k, v);

      expect((await entwuerfeLaden(7)).map((e) => e.inhalt)).toEqual(['jung']);
    });
  });
});
