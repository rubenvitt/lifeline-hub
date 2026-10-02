import { describe, expect, it } from 'vitest';
import type { WetterSymbol } from '../api/types';
import {
  IconGewitterwolke,
  IconHagel,
  IconMond,
  IconNebel,
  IconNebelNacht,
  IconRegen,
  IconSchneeregen,
  IconSchneewolke,
  IconSonne,
  IconTeilsBewoelktNacht,
  IconTeilsBewoelktTag,
  IconWind,
  IconWolke,
  type Icon,
} from '../icons';
import { wetterSymbolIcon } from './wetterSymbol';

/** Die freigegebene Zuordnung (LFH-864 design.md D5, Bildbogen vom 01.10.2026). */
const ERWARTET: ReadonlyArray<[WetterSymbol, Icon]> = [
  ['klar_tag', IconSonne],
  ['klar_nacht', IconMond],
  ['teils_bewoelkt_tag', IconTeilsBewoelktTag],
  ['teils_bewoelkt_nacht', IconTeilsBewoelktNacht],
  ['bewoelkt', IconWolke],
  ['nebel_tag', IconNebel],
  ['nebel_nacht', IconNebelNacht],
  ['wind', IconWind],
  ['regen', IconRegen],
  ['schneeregen', IconSchneeregen],
  ['schnee', IconSchneewolke],
  ['hagel', IconHagel],
  ['gewitter', IconGewitterwolke],
];

describe('wetterSymbolIcon', () => {
  it.each(ERWARTET)('%s', (symbol, icon) => {
    expect(wetterSymbolIcon(symbol)).toBe(icon);
  });

  it('ohne (unbekannte) Wetterlage kein Icon', () => {
    expect(wetterSymbolIcon(undefined)).toBeNull();
    expect(wetterSymbolIcon(null)).toBeNull();
  });
});
