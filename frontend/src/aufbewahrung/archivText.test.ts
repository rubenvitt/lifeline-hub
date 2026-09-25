import { describe, expect, it } from 'vitest';
import { aufbewahrungZustand, etbTyp } from '../theme/statusFarben';
import { ETB_TYPEN, ZUSTAENDE, primaeraktion } from './archivText';

describe('archivText', () => {
  it('die Zustände sind vollständig und in der Lebenslinie geordnet', () => {
    expect(ZUSTAENDE).toEqual([
      'ohne_frist',
      'frist_laeuft',
      'faellig',
      'vorgemerkt',
      'schwaerzung_ausstehend',
      'geschwaerzt',
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
      null,
    ]);
  });
});
