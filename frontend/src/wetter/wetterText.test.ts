import { describe, expect, it } from 'vitest';
import type { WetterErgaenzung } from '../api/types';
import {
  druckText,
  entfernungText,
  ergaenztVon,
  niederschlagText,
  prozentText,
  sichtText,
  stationText,
  temperaturText,
  titelSchreibung,
  warnZeitraum,
  wetterSymbolWort,
  windText,
  zahlText,
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

describe('aktuelle Bedingungen (LFH-864) — ein fehlender Wert ist ein Strich, nie 0', () => {
  it('Zahl für die Kennzahl, ohne Einheit, mit Minus U+2212', () => {
    expect(zahlText(15.25, 1)).toBe('15,3');
    expect(zahlText(-0.4, 1)).toBe('−0,4');
    expect(zahlText(0, 1)).toBe('0,0');
    expect(zahlText(16.6, 0)).toBe('17');
    expect(zahlText(null, 1)).toBe('—');
    expect(zahlText(Number.NaN, 0)).toBe('—');
  });

  it('Sicht unter 1 km in m, sonst km mit einer Stelle', () => {
    expect(sichtText(180)).toBe('180 m');
    expect(sichtText(53235)).toBe('53,2 km');
    expect(sichtText(undefined)).toBe('—');
  });

  it('Prozent und Luftdruck', () => {
    expect(prozentText(80)).toBe('80 %');
    expect(prozentText(0)).toBe('0 %');
    expect(prozentText(null)).toBe('—');
    expect(druckText(1020.8)).toBe('1021 hPa');
    expect(druckText(undefined)).toBe('—');
  });

  it('ein Wort je Wetterlage, Tag und Nacht gleich benannt', () => {
    expect(wetterSymbolWort('klar_tag')).toBe('klar');
    expect(wetterSymbolWort('klar_nacht')).toBe('klar');
    expect(wetterSymbolWort('teils_bewoelkt_nacht')).toBe('teils bewölkt');
    expect(wetterSymbolWort('bewoelkt')).toBe('bewölkt');
    expect(wetterSymbolWort('nebel_nacht')).toBe('Nebel');
    expect(wetterSymbolWort('wind')).toBe('windig');
    expect(wetterSymbolWort('schneeregen')).toBe('Schneeregen');
    expect(wetterSymbolWort('gewitter')).toBe('Gewitter');
    expect(wetterSymbolWort(undefined)).toBe('—');
  });

  it('Herkunft eines ergänzten Werts: „Station Hameln, 12,1 km", sonst null', () => {
    const ergaenzt: WetterErgaenzung[] = [
      { station: { name: 'Hameln-Hastenbeck', entfernung_m: 11086 }, groessen: ['temperatur'] },
      { station: { name: 'Hameln', entfernung_m: 12094 }, groessen: ['wind', 'boeen'] },
    ];
    expect(ergaenztVon(ergaenzt, 'boeen')).toBe('Station Hameln, 12,1 km');
    expect(ergaenztVon(ergaenzt, 'temperatur')).toBe('Station Hameln-Hastenbeck, 11,1 km');
    expect(ergaenztVon(ergaenzt, 'sicht')).toBeNull();
    expect(ergaenztVon([], 'wind')).toBeNull();
  });
});
