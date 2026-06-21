import { describe, it, expect, afterEach } from 'vitest';
import { ortKeyVon, holeOrt, setzeOrt, leereOrtCache } from './ortCache';

describe('ortCache', () => {
  afterEach(() => leereOrtCache());

  it('rundet den Key auf 3 Nachkommastellen (~100 m)', () => {
    expect(ortKeyVon(51.16040, 10.45140)).toBe('51.160,10.451');
    expect(ortKeyVon(51.16042, 10.45138)).toBe(ortKeyVon(51.16040, 10.45140));
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
});
