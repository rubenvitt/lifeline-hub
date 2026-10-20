import { describe, expect, it } from 'vitest';
import { modulRegistry, moduleNachKategorie, type ModulEintrag } from './modulRegistry';
import { unterseitenFuer } from '../stab/unterseiten';
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
    // Die übrigen Module des Entwurfs sind Folgetasks oder verworfen (LFH-620); das FMS-Tableau ist
    // eine Ansicht der Fahrzeugseite (LFH-642).
    expect(sprungmarken.map((m) => m.key)).toEqual([
      'entscheidungen',
      'patienten',
      'vermisste',
      'fms-tableau',
      // Arbeitsseiten des Stabs (LLH-1127), Sachgebiet S5.
      'presse',
      'infotelefon',
      // Ansichten des Fernmeldewesens (LLH-1180); den Funkplan öffnet das Modul selbst.
      'fernmeldeskizze',
      'kommunikationsplan',
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
      presse: '/einsaetze/7/stab/presse',
      infotelefon: '/einsaetze/7/stab/infotelefon',
      fernmeldeskizze: '/einsaetze/7/fernmeldewesen?ansicht=skizze',
      kommunikationsplan: '/einsaetze/7/fernmeldewesen/kommunikationsplan',
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
      'lagebesprechung',
      'stab',
      '↗presse',
      '↗infotelefon',
      'dokumente',
    ]);
    expect(
      folge(moduleNachKategorie('kommunikation'), sprungmarkenNachKategorie('kommunikation')),
    ).toEqual([
      'chat',
      'erinnerungen',
      'meldungen',
      'nachforderungen',
      'fernmeldewesen',
      '↗fernmeldeskizze',
      '↗kommunikationsplan',
    ]);
    expect(folge(moduleNachKategorie('erfassung'), sprungmarkenNachKategorie('erfassung'))).toEqual(
      [
        'etb',
        'personen',
        '↗patienten',
        '↗vermisste',
        'unfallhilfsstellen',
        'evakuierung',
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
      'verpflegung',
      'bereitstellungsraeume',
      'abloesung',
    ]);
  });

  it('führt jede Unterseite der Stab-Seite genau einmal, mit deren Namen, Adresse und Modul (LLH-1127)', () => {
    // Eine Wahrheit: benennt die Stab-Seite eine Unterseite um, zieht das Menü mit.
    const seiten = (['s1', 's2', 's3', 's4', 's5', 's6'] as const).flatMap((s) =>
      unterseitenFuer(s),
    );
    expect(seiten.length).toBeGreaterThan(0);
    for (const seite of seiten) {
      const marken = sprungmarken.filter((m) => m.key === seite.key);
      // Der Funkplan ist die Modulroute des Fernmeldewesens (LLH-1180): keine eigene Marke.
      if (seite.key === 'funkplan') {
        expect(marken, seite.key).toHaveLength(0);
        expect(seite.pfad(7)).toBe('/einsaetze/7/fernmeldewesen');
        continue;
      }
      // Die Sprechgruppen sind eine Darstellung des Funkplans (LLH-1124): keine eigene Marke,
      // das Schlagwort „sprechgruppe“ führt in die Fernmeldeskizze.
      if (seite.key === 'sprechgruppen') {
        expect(marken, seite.key).toHaveLength(0);
        continue;
      }
      expect(marken, seite.key).toHaveLength(1);
      expect(marken[0].label).toBe(seite.label);
      expect(marken[0].pfad(7)).toBe(seite.pfad(7));
      expect(marken[0].zielModul).toBe(seite.modul);
    }
  });

  it('nennt das Ziel ohne Verb (LFH-1078)', () => {
    const hinweise = Object.fromEntries(sprungmarken.map((m) => [m.key, m.hinweis]));
    expect(hinweise).toMatchObject({
      presse: 'Stab · Pressearbeit',
      infotelefon: 'Stab · Informationstelefon',
      fernmeldeskizze: 'Fernmeldewesen · Skizze',
      kommunikationsplan: 'Fernmeldewesen · Kommunikationsplan',
    });
  });

  it('trägt Schlagworte für die Sprungpalette', () => {
    for (const marke of sprungmarken) {
      expect(marke.schlagworte.length, marke.key).toBeGreaterThan(0);
    }
    const worte = (key: string) => sprungmarken.find((m) => m.key === key)!.schlagworte;
    expect(worte('fernmeldeskizze')).toEqual(
      expect.arrayContaining(['sprechgruppe', 'tmo', 'dmo', 's6']),
    );
    expect(worte('kommunikationsplan')).toEqual(
      expect.arrayContaining(['telefon', 'rufnummer', 'leitstelle', 's6']),
    );
    expect(worte('presse')).toEqual(expect.arrayContaining(['presse', 'medien', 's5']));
    expect(worte('infotelefon')).toEqual(
      expect.arrayContaining(['bürgertelefon', 'anrufe', 'hotline', 's5']),
    );
    expect(worte('fernmeldeskizze')).toEqual(expect.arrayContaining(['skizze', 's6']));
  });

  it('hängt eine Marke ohne auffindbaren Anker ans Ende, statt sie zu verlieren', () => {
    const module = moduleNachKategorie('fuehrung').filter((m) => m.key !== 'auftraege');
    const zeilen = folge(module, sprungmarkenNachKategorie('fuehrung'));
    expect(zeilen[zeilen.length - 1]).toBe('↗entscheidungen');
  });
});
