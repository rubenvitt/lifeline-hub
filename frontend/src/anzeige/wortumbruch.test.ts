import { describe, expect, it } from 'vitest';
import { WORTUMBRUCH_STIL } from './wortumbruch';

describe('WORTUMBRUCH_STIL (LLH-1793)', () => {
  it('trennt an Silbengrenzen, hebt antds Wortbruch auf und nie „anywhere“', () => {
    expect(WORTUMBRUCH_STIL).toEqual({
      overflowWrap: 'break-word',
      hyphens: 'auto',
      wordBreak: 'normal',
    });
  });
});
