import { describe, expect, it } from 'vitest';
import { kategorien, modulRegistry, type KategorieKey } from '../einsatz/modulRegistry';
import { KAPITEL } from './kapitel';
import { BEREICHE, bereichVon } from './bereiche';

/**
 * Wächter (y3zh5ymv D11, Spec `modul-benennung`, „Die Hilfe gliedert wie die Navigation“): das
 * Kapitel eines Moduls steht im Bereich der Kategorie seines Moduls. Wer ein Modul in eine andere
 * Kategorie schiebt, ohne sein Kapitel umzuhängen, oder ein Modul ohne Kapitelzuordnung anlegt,
 * macht ihn rot.
 *
 * Zwischen Modul und Kapitel gibt es sonst keine Verbindung im Code; die Tabelle ist sie. Ein
 * Kapitel kann mehrere Module tragen (Fernmeldewesen samt Funkplan), ein Modul hat genau eines.
 */
const KAPITEL_JE_MODUL: Readonly<Record<string, string>> = {
  ueberblick: 'ueberblick',
  etb: 'einsatztagebuch',
  einsatzdaten: 'einsatzdaten',
  einsatzabschnitte: 'einsatzabschnitte',
  auftraege: 'auftraege-befehle',
  lagebesprechung: 'lagebesprechung',
  dokumente: 'dokumente',
  kraefteuebersicht: 'meldebild',
  einheiten: 'einheiten',
  personal: 'personal',
  fahrzeuge: 'fahrzeuge',
  material: 'material',
  verpflegung: 'verpflegung',
  bereitstellungsraeume: 'bereitstellungsraeume',
  nachforderungen: 'nachforderung',
  abloesung: 'abloesung',
  personen: 'betroffene',
  unfallhilfsstellen: 'unfallhilfsstellen',
  evakuierung: 'evakuierung',
  betreuung: 'betreuung',
  tiere: 'tiere',
  schaeden: 'schaeden',
  'lage-dashboard': 'lagebild',
  lagekarte: 'lagekarte',
  lageberichte: 'lageberichte',
  gefahrenzonen: 'gefahren',
  'wetter-pegel': 'wetter-pegel',
  lagemeldungen: 'lagemeldungen',
  chat: 'chat',
  erinnerungen: 'erinnerungen',
  meldungen: 'meldungen',
  fernmeldewesen: 'funkplan',
  infotelefon: 'infotelefon',
  'einsatz-einstellungen': 'einsatz-einstellungen',
};

/**
 * Der Bereich der Hilfe je Kategorie der Navigation. Gleich benannt, nur die Einstellungen heißen in
 * der Hilfe „Einstellungen und Verwaltung“, weil dort auch die Verwaltung der Organisation steht.
 */
const BEREICH_JE_KATEGORIE: Readonly<Record<KategorieKey, string>> = {
  fuehrung: 'Führung',
  kraefte: 'Kräfte & Mittel',
  erfassung: 'Betroffene & Schäden',
  lage: 'Lage',
  kommunikation: 'Kommunikation',
  einstellungen: 'Einstellungen und Verwaltung',
};

describe('Hilfe gliedert wie die Navigation (y3zh5ymv D11)', () => {
  it('nennt die Bereiche der Kategorien gleich der Navigation', () => {
    for (const k of kategorien) {
      const bereich = BEREICH_JE_KATEGORIE[k.key];
      expect(BEREICHE, k.key).toContain(bereich);
      if (k.key !== 'einstellungen') expect(bereich, k.key).toBe(k.label);
    }
  });

  it('ordnet die Bereiche in der Folge der Rail, nach dem Einstieg', () => {
    const folge = kategorien.filter((k) => !k.fuss).map((k) => BEREICH_JE_KATEGORIE[k.key]);
    expect(BEREICHE.slice(1, 1 + folge.length)).toEqual(folge);
  });

  it('kennt zu jedem Modul der Registry ein Kapitel', () => {
    for (const m of modulRegistry) {
      expect(KAPITEL_JE_MODUL[m.key], `Modul ${m.key} ohne Kapitel`).toBeDefined();
      expect(
        KAPITEL.some((k) => k.slug === KAPITEL_JE_MODUL[m.key]),
        `Kapitel ${KAPITEL_JE_MODUL[m.key]} fehlt`,
      ).toBe(true);
    }
  });

  it('stellt das Kapitel eines Moduls in den Bereich seiner Kategorie', () => {
    for (const m of modulRegistry) {
      const kapitel = KAPITEL.find((k) => k.slug === KAPITEL_JE_MODUL[m.key])!;
      expect(bereichVon(kapitel.reihenfolge), `${m.key} → ${kapitel.slug}`).toBe(
        BEREICH_JE_KATEGORIE[m.kategorie],
      );
    }
  });
});
