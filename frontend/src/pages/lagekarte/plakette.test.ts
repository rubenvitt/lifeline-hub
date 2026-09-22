import { describe, it, expect } from 'vitest';
import { plakettenSchrift, PLAKETTEN_MONO } from './plakette';
import { blindStyle, offlineStyle } from './basemapStil';

/**
 * LFH-622: Welche Schrift die Beschriftungsplaketten anfordern, hängt am Glyphen-Server des
 * aktiven Stils. Einen Fontstack, den der Server nicht führt, beantwortet er mit 404; MapLibre
 * zeichnet dann lokal in einer Systemschrift und warnt je Zeichen. Deshalb Mono NUR offline,
 * wo der eigene Server sie ausliefert.
 */
describe('plakettenSchrift', () => {
  it('nimmt offline die eingebettete Mono-Schrift', () => {
    const stil = offlineStyle('dark', [
      { karte_id: 1, tiles_url: '/t/{z}/{x}/{y}', maxzoom: 14 } as never,
    ]);
    expect(plakettenSchrift(stil)).toEqual(['JetBrains Mono Regular']);
    expect(PLAKETTEN_MONO).toBe('JetBrains Mono Regular');
  });

  it('nimmt online die Schrift, die der Anbieter-Stil selbst verwendet', () => {
    const stil = {
      glyphs: 'https://anbieter.example/fonts/{fontstack}/{range}.pbf',
      layers: [
        { id: 'wasser', type: 'fill' },
        { id: 'strasse', type: 'symbol', layout: { 'text-font': ['Metropolis Regular'] } },
        { id: 'ort', type: 'symbol', layout: { 'text-font': ['Anderes'] } },
      ],
    };
    expect(plakettenSchrift(stil)).toEqual(['Metropolis Regular']);
  });

  it('liest auch die `literal`-Schreibweise eines Anbieter-Stils', () => {
    const stil = {
      glyphs: 'https://anbieter.example/{fontstack}/{range}.pbf',
      layers: [
        { id: 'a', type: 'symbol', layout: { 'text-font': ['literal', ['Noto Sans Bold']] } },
      ],
    };
    expect(plakettenSchrift(stil)).toEqual(['Noto Sans Bold']);
  });

  it('überspringt Ausdrücke, die es nicht auflösen kann, statt sie zu übernehmen', () => {
    const stil = {
      glyphs: 'https://anbieter.example/{fontstack}/{range}.pbf',
      layers: [
        { id: 'a', type: 'symbol', layout: { 'text-font': ['step', ['zoom'], ['A'], 10, ['B']] } },
      ],
    };
    expect(plakettenSchrift(stil)).toBeUndefined();
  });

  it('lässt die Schrift ohne Glyphen-Server offen (Blindkarte: MapLibre zeichnet lokal)', () => {
    expect(plakettenSchrift(blindStyle('dark'))).toBeUndefined();
    expect(plakettenSchrift(undefined)).toBeUndefined();
  });
});
