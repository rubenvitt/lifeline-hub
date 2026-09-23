import { describe, expect, it } from 'vitest';
import { modulRegistry, moduleNachKategorie, type ModulEintrag } from './modulRegistry';
import {
  navZeilen,
  sprungmarken,
  sprungmarkenNachKategorie,
  sprungZiel,
  type Sprungmarke,
} from './sprungmarken';

/** Reihenfolge als lesbare Schlüsselliste, Marken mit `↗` davor. */
const folge = (module: ModulEintrag[], marken: Sprungmarke[]) =>
  navZeilen(module, marken).map((z) => (z.art === 'modul' ? z.modul.key : `↗${z.marke.key}`));

describe('Sprungmarken (LFH-620)', () => {
  it('führt genau die entschiedenen Sichten', () => {
    // Die übrigen Module des Entwurfs sind Folgetasks oder verworfen — siehe LFH-620. Das
    // FMS-Tableau ist LFH-642: eine Ansicht der Fahrzeugseite, kein eigenes Modul.
    expect(sprungmarken.map((m) => m.key)).toEqual([
      'entscheidungen',
      'patienten',
      'vermisste',
      'fms-tableau',
    ]);
  });

  it('springt über die zentralen Builder auf die erwarteten Adressen', () => {
    // Literale, nicht aus den Buildern zurückgelesen — sonst prüfte der Test sie gegen sich.
    const pfade = Object.fromEntries(sprungmarken.map((m) => [m.key, m.pfad(7)]));
    expect(pfade).toEqual({
      entscheidungen: '/einsaetze/7/etb?typ=entscheidung',
      patienten: '/einsaetze/7/personen?filter=alle&ansicht=raster',
      vermisste: '/einsaetze/7/personen?filter=vermisst&ansicht=zeilen',
      'fms-tableau': '/einsaetze/7/fahrzeuge?ansicht=tableau',
    });
  });

  it('zeigt nur auf fertige Registry-Module und verankert sich in der eigenen Kategorie', () => {
    const schluessel = new Set(sprungmarken.map((m) => m.key));
    for (const marke of sprungmarken) {
      const ziel = sprungZiel(marke);
      expect(ziel, marke.key).not.toBeNull();
      expect(ziel?.status, marke.key).toBe('fertig');
      // Der Anker ist ein Modul DERSELBEN Kategorie oder eine andere Marke.
      const anker = modulRegistry.find((m) => m.key === marke.nach);
      expect(anker?.kategorie === marke.kategorie || schluessel.has(marke.nach), marke.key).toBe(
        true,
      );
      // Kein Schlüssel eines echten Moduls: Overrides und `modulZuRoute` kennen nur Module.
      expect(
        modulRegistry.some((m) => m.key === marke.key),
        marke.key,
      ).toBe(false);
    }
  });

  it('steht im Panel dort, wo der Entwurf sie führt', () => {
    expect(folge(moduleNachKategorie('fuehrung'), sprungmarkenNachKategorie('fuehrung'))).toEqual([
      'ueberblick',
      'einsatzdaten',
      'einsatzabschnitte',
      'auftraege',
      '↗entscheidungen',
      'stab',
      'dokumente',
    ]);
    expect(folge(moduleNachKategorie('erfassung'), sprungmarkenNachKategorie('erfassung'))).toEqual(
      [
        'etb',
        'personen',
        '↗patienten',
        '↗vermisste',
        'unfallhilfsstellen',
        'betreuung',
        'tiere',
        'schaeden',
      ],
    );
    expect(folge(moduleNachKategorie('kraefte'), sprungmarkenNachKategorie('kraefte'))).toEqual([
      'kraefteuebersicht',
      'einheiten',
      'personal',
      'fahrzeuge',
      '↗fms-tableau',
      'material',
      'bereitstellungsraeume',
      'abloesung',
    ]);
  });

  it('hängt eine Marke ohne auffindbaren Anker ans Ende, statt sie zu verlieren', () => {
    const module = moduleNachKategorie('fuehrung').filter((m) => m.key !== 'auftraege');
    const zeilen = folge(module, sprungmarkenNachKategorie('fuehrung'));
    expect(zeilen[zeilen.length - 1]).toBe('↗entscheidungen');
  });
});
