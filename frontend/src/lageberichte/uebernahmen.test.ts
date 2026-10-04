import { describe, expect, it } from 'vitest';
import { MEDIENLAGE_QUELLE } from '../stab/medienlageUebernahme';
import { EIGENE_LAGE_QUELLE } from './eigeneLageUebernahme';
import { FUEHRUNGSPROBLEME_QUELLE } from './fuehrungsproblemeUebernahme';
import { SCHADENLAGE_QUELLE } from './schadenlageUebernahme';
import { UEBERNAHMEN, uebernahmeFuer } from './uebernahmen';
import { VORLAGEN, vorlage } from './vorlagen';

describe('Zuordnung Abschnitt → Quelle (LFH-870)', () => {
  it('bindet Eigene Lage und Medienlage im Lagevortrag zur Information an', () => {
    expect(uebernahmeFuer('lagebericht', 'eigene_lage')).toBe(EIGENE_LAGE_QUELLE);
    expect(uebernahmeFuer('lagebericht', 'medienlage')).toBe(MEDIENLAGE_QUELLE);
    expect(uebernahmeFuer('lagebericht', 'auftrag')).toBeUndefined();
  });

  it('bindet die weiteren Abschnitte des Lagevortrags zur Information an (LFH-869)', () => {
    expect(uebernahmeFuer('lagebericht', 'gefahren_schadenlage')).toBe(SCHADENLAGE_QUELLE);
    expect(uebernahmeFuer('lagebericht', 'fuehrungsprobleme')).toBe(FUEHRUNGSPROBLEME_QUELLE);
    for (const ohne of ['auftrag', 'antraege_vorschlaege', 'zusammenfassung'])
      expect(uebernahmeFuer('lagebericht', ohne)).toBeUndefined();
  });

  it('lässt den Lagevortrag zur Entscheidung und den freien Bericht von Hand', () => {
    for (const v of VORLAGEN.filter((v) => v.schluessel !== 'lagebericht')) {
      for (const a of v.abschnitte)
        expect(uebernahmeFuer(v.schluessel, a.schluessel)).toBeUndefined();
    }
  });

  it('nennt nur Abschnitte, die es in der Vorlage gibt', () => {
    for (const [v, abschnitte] of Object.entries(UEBERNAHMEN)) {
      const schluessel = vorlage(v as 'lagebericht')!.abschnitte.map((a) => a.schluessel);
      for (const a of Object.keys(abschnitte)) expect(schluessel).toContain(a);
    }
  });
});
