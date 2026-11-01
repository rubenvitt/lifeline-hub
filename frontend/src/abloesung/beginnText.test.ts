import { describe, expect, it } from 'vitest';
import type { BeginnQuelle } from '../api/types';
import { beginnWort } from './beginnText';

describe('beginnWort (LLH-1312)', () => {
  it('nennt die Herkunft vor dem Beginn', () => {
    expect(beginnWort('hand')).toBe('im Einsatz seit');
    expect(beginnWort('eintreffen')).toBe('seit Eintreffen');
    expect(beginnWort('vollzug')).toBe('Folgeschicht seit');
  });

  it('liest einen fehlenden oder unbekannten Wert wie von Hand', () => {
    expect(beginnWort(undefined)).toBe('im Einsatz seit');
    expect(beginnWort('automatisch' as BeginnQuelle)).toBe('im Einsatz seit');
  });
});
