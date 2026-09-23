import { describe, expect, it } from 'vitest';
import {
  entfernungText,
  niederschlagText,
  stationText,
  temperaturText,
  titelSchreibung,
  warnZeitraum,
  windText,
} from './wetterText';

const BERLIN = { zeitzone: 'Europe/Berlin' };
/** 2026-09-22 12:30:00 UTC = 14:30 Berlin. */
const JETZT = Date.UTC(2026, 8, 22, 12, 30, 0);

describe('titelSchreibung', () => {
  it('macht aus Versalien der Quelle lesbare Wörter, auch mit Umlaut und Bindestrich', () => {
    expect(titelSchreibung('ORKANARTIGE BÖEN')).toBe('Orkanartige Böen');
    expect(titelSchreibung('BREMEN')).toBe('Bremen');
    expect(titelSchreibung('BERLIN-ALEX.')).toBe('Berlin-Alex.');
    expect(titelSchreibung('  ')).toBe('');
  });
});

describe('entfernungText / stationText', () => {
  it('unter 1 km in m, darüber km mit einer Nachkommastelle und deutschem Komma', () => {
    expect(entfernungText(850)).toBe('850 m');
    expect(entfernungText(4200)).toBe('4,2 km');
    expect(entfernungText(null)).toBeNull();
  });

  it('„Station Bremen, 4,2 km" — ohne Entfernung nur der Name, ohne Station null', () => {
    expect(stationText('BREMEN', 4200)).toBe('Station Bremen, 4,2 km');
    expect(stationText('BREMEN', null)).toBe('Station Bremen');
    expect(stationText(null, 4200)).toBeNull();
  });
});

describe('Messwerte — ein fehlender Wert ist ein Strich, nie 0', () => {
  it('Temperatur', () => {
    expect(temperaturText(18.6)).toBe('18,6 °C');
    expect(temperaturText(-2)).toBe('−2,0 °C');
    expect(temperaturText(undefined)).toBe('—');
  });

  it('Niederschlag mit Wahrscheinlichkeit', () => {
    expect(niederschlagText(0, 20)).toBe('0,0 mm · 20 %');
    expect(niederschlagText(1.25, undefined)).toBe('1,3 mm · —');
    expect(niederschlagText(undefined, undefined)).toBe('— · —');
  });

  it('Wind mit Richtung und Böen', () => {
    expect(windText(11.1, 18.5, 192)).toBe('aus S 11 km/h · Böen 19 km/h');
    // Eine fehlende Richtung ist fehlend markiert, nicht still weggelassen.
    expect(windText(11.1, undefined, undefined)).toBe('aus — 11 km/h · Böen —');
    expect(windText(undefined, undefined, undefined)).toBe('aus — — · Böen —');
  });
});

describe('warnZeitraum', () => {
  it('geltende Warnung: „seit … · bis …"', () => {
    expect(warnZeitraum('2026-09-22T11:00:00Z', '2026-09-22T14:00:00Z', JETZT, BERLIN)).toBe(
      'seit 13:00 · bis 16:00',
    );
  });

  it('angekündigte Warnung: „ab … · bis …", am anderen Tag mit Tag davor', () => {
    expect(warnZeitraum('2026-09-22T15:00:00Z', '2026-09-23T06:00:00Z', JETZT, BERLIN)).toBe(
      'ab 17:00 · bis 23. 08:00',
    );
  });

  it('ohne Ende „bis auf Weiteres", ohne Beginn nur das Ende', () => {
    expect(warnZeitraum('2026-09-22T11:00:00Z', null, JETZT, BERLIN)).toBe(
      'seit 13:00 · bis auf Weiteres',
    );
    expect(warnZeitraum(null, '2026-09-22T14:00:00Z', JETZT, BERLIN)).toBe('bis 16:00');
  });
});
