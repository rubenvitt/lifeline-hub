import { describe, expect, it } from 'vitest';
import { checkNodeVersion } from './suitenNode';

describe('Node-Version der Suite (LLH-2134)', () => {
  it('lässt dieselbe Hauptversion durch, auch mit anderem Patch', () => {
    expect(checkNodeVersion('26.13.1', '26.13.1')).toBeNull();
    expect(checkNodeVersion('v26.2.0', '26.13.1')).toBeNull();
  });

  it('nennt eine andere Hauptversion mit beiden Zahlen und dem Weg über mise', () => {
    const meldung = checkNodeVersion('v22.23.5', '26.13.1');
    expect(meldung).toContain('22.23.5');
    expect(meldung).toContain('26.13.1');
    expect(meldung).toContain('mise exec --');
  });

  it('lässt ohne Vorgabe alles durch', () => {
    expect(checkNodeVersion('v22.23.5', undefined)).toBeNull();
  });
});
