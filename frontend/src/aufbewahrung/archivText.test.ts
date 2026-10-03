import { describe, expect, it } from 'vitest';
import { aufbewahrungZustand, etbTyp } from '../theme/statusFarben';
import { ETB_TYPEN, ZIEL_ART, ZUSTAENDE, primaeraktion } from './archivText';

describe('archivText', () => {
  it('die Zustände sind vollständig und in der Lebenslinie geordnet', () => {
    expect(ZUSTAENDE).toEqual([
      'ohne_frist',
      'frist_laeuft',
      'faellig',
      'vorgemerkt',
      'schwaerzung_ausstehend',
      'schwaerzung_beantragt',
      'geschwaerzt',
      'loeschung_ausstehend',
      'endgueltig_geloescht',
    ]);
    expect([...ZUSTAENDE].sort()).toEqual(Object.keys(aufbewahrungZustand).sort());
  });

  it('der ETB-Filter führt jeden ETB-Typ', () => {
    expect([...ETB_TYPEN].sort()).toEqual(Object.keys(etbTyp).sort());
  });

  it('genau eine Primäraktion je Zustand', () => {
    expect(ZUSTAENDE.map(primaeraktion)).toEqual([
      'frist',
      'frist',
      'frist',
      'wiederherstellen',
      null,
      // LFH-751: bei offenem Einsatz-Antrag steht die Rücknahme am Antrag, nicht im Kopf.
      null,
      null,
      null,
      null,
    ]);
  });

  it('jede Zielart eines Löschersuchens hat ein Wort (LFH-751)', () => {
    expect(Object.keys(ZIEL_ART).sort()).toEqual([
      'betroffene',
      'einsatz',
      'externe_kraft',
      'infotelefon_anruf',
      'medienkontakt',
    ]);
  });
});
