import { describe, expect, it } from 'vitest';
import type { WetterSymbol } from '../api/types';
import {
  IkoneGewitterwolke,
  IkoneHagel,
  IkoneMond,
  IkoneNebel,
  IkoneNebelNacht,
  IkoneRegen,
  IkoneSchneeregen,
  IkoneSchneewolke,
  IkoneSonne,
  IkoneTeilsBewoelktNacht,
  IkoneTeilsBewoelktTag,
  IkoneWind,
  IkoneWolke,
  type Ikone,
} from '../ikonen';
import { wetterSymbolIkone } from './wetterSymbol';

/** Die freigegebene Zuordnung (LFH-864 design.md D5, Bildbogen vom 01.10.2026). */
const ERWARTET: ReadonlyArray<[WetterSymbol, Ikone]> = [
  ['klar_tag', IkoneSonne],
  ['klar_nacht', IkoneMond],
  ['teils_bewoelkt_tag', IkoneTeilsBewoelktTag],
  ['teils_bewoelkt_nacht', IkoneTeilsBewoelktNacht],
  ['bewoelkt', IkoneWolke],
  ['nebel_tag', IkoneNebel],
  ['nebel_nacht', IkoneNebelNacht],
  ['wind', IkoneWind],
  ['regen', IkoneRegen],
  ['schneeregen', IkoneSchneeregen],
  ['schnee', IkoneSchneewolke],
  ['hagel', IkoneHagel],
  ['gewitter', IkoneGewitterwolke],
];

describe('wetterSymbolIkone', () => {
  it.each(ERWARTET)('%s', (symbol, ikone) => {
    expect(wetterSymbolIkone(symbol)).toBe(ikone);
  });

  it('ohne (unbekannte) Wetterlage keine Ikone', () => {
    expect(wetterSymbolIkone(undefined)).toBeNull();
    expect(wetterSymbolIkone(null)).toBeNull();
  });
});
