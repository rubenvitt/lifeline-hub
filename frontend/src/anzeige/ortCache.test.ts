import { describe, it, expect, afterEach } from 'vitest';
import { rohLesen } from '../test/rohIdb';
import { ortKeyVon, holeOrt, setzeOrt, ortCacheRaeumen } from './ortCache';

describe('ortCache', () => {
  afterEach(() => ortCacheRaeumen());

  it('rundet den Key auf 3 Nachkommastellen (~100 m)', () => {
    expect(ortKeyVon(51.1604, 10.4514)).toBe('51.160,10.451');
    expect(ortKeyVon(51.16042, 10.45138)).toBe(ortKeyVon(51.1604, 10.4514));
  });

  it('set→get-Roundtrip; Miss → null', async () => {
    const key = ortKeyVon(51.1604, 10.4514);
    expect(await holeOrt(key)).toBeNull();
    await setzeOrt(key, 'Hauptstr. 5, Musterstadt');
    expect(await holeOrt(key)).toBe('Hauptstr. 5, Musterstadt');
  });

  it('überschreibt vorhandenen Wert', async () => {
    const key = ortKeyVon(48.0, 11.0);
    await setzeOrt(key, 'Alt');
    await setzeOrt(key, 'Neu');
    expect(await holeOrt(key)).toBe('Neu');
  });

  it('räumt beim Ausgang die Platte (LFH-767)', async () => {
    await setzeOrt(ortKeyVon(51.1604, 10.4514), 'Hauptstr. 5, Musterstadt');
    expect(await rohLesen('lifeline-ortcache', 'ortsnamen')).toHaveLength(1);

    await ortCacheRaeumen();

    expect(await rohLesen('lifeline-ortcache', 'ortsnamen')).toEqual([]);
  });
});
