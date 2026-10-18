import { describe, expect, it } from 'vitest';
import { isWeitGerollt } from './nachOben';

describe('isWeitGerollt', () => {
  it('erst mehr als eine Fensterhöhe unter dem Anfang', () => {
    expect(isWeitGerollt(0, 800)).toBe(false);
    expect(isWeitGerollt(800, 800)).toBe(false);
    expect(isWeitGerollt(801, 800)).toBe(true);
  });
});
