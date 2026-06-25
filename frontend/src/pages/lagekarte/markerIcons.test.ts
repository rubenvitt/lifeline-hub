import { describe, it, expect } from 'vitest';
import { tzIconKey } from './markerIcons';

describe('tzIconKey', () => {
  it('ist deterministisch für gleiche TzProps', () => {
    expect(tzIconKey({ grundzeichen: 'anlass' })).toBe(tzIconKey({ grundzeichen: 'anlass' }));
  });

  it('beginnt mit dem tz|-Präfix (für den styleimagemissing-Filter)', () => {
    expect(tzIconKey({ grundzeichen: 'anlass' }).startsWith('tz|')).toBe(true);
  });

  it('unterscheidet sich bei abweichender farbe', () => {
    expect(tzIconKey({ grundzeichen: 'gefahr', farbe: '#f5222d' }))
      .not.toBe(tzIconKey({ grundzeichen: 'gefahr', farbe: '#faad14' }));
  });

  it('unterscheidet sich bei symbol/fachaufgabe/organisation/einheit', () => {
    const base = { grundzeichen: 'stelle' } as const;
    expect(tzIconKey({ ...base, symbol: 'sammeln' }))
      .not.toBe(tzIconKey({ ...base, symbol: 'sammelplatz-betroffene' }));
    expect(tzIconKey({ ...base, fachaufgabe: 'fuehrung' })).not.toBe(tzIconKey(base));
    expect(tzIconKey({ grundzeichen: 'taktische-formation', einheit: 'zug' }))
      .not.toBe(tzIconKey({ grundzeichen: 'taktische-formation', einheit: 'gruppe' }));
  });
});
