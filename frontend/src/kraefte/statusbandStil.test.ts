import { describe, expect, it } from 'vitest';
import { bandSpalten } from './statusbandStil';
import type { AbBreitePunkt } from '../components/useViewport';

const ab =
  (bis: AbBreitePunkt | null) =>
  (punkt: AbBreitePunkt): boolean => {
    const folge: AbBreitePunkt[] = ['sm', 'md', 'lg', 'xl', 'xxl'];
    return bis != null && folge.indexOf(punkt) <= folge.indexOf(bis);
  };

describe('bandSpalten', () => {
  it('6 ab xl, 3 ab md, 2 darunter', () => {
    expect(bandSpalten(ab('xxl'))).toBe(6);
    expect(bandSpalten(ab('xl'))).toBe(6);
    expect(bandSpalten(ab('lg'))).toBe(3);
    expect(bandSpalten(ab('md'))).toBe(3);
    expect(bandSpalten(ab('sm'))).toBe(2);
    expect(bandSpalten(ab(null))).toBe(2);
  });
});
