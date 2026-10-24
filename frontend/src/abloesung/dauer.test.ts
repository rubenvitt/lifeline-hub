import { describe, expect, it } from 'vitest';
import {
  formatDauer,
  formatUhrzeiten,
  parseDauer,
  parseUhrzeiten,
  uhrzeitenFeldText,
} from './dauer';

describe('formatDauer (LLH-1122)', () => {
  it('schreibt ganze Stunden als „8 h“, nie mit Dezimalpunkt', () => {
    expect(formatDauer(480)).toBe('8 h');
    expect(formatDauer(720)).toBe('12 h');
    expect(formatDauer(480)).not.toContain('.');
  });
  it('schreibt angebrochene Stunden als „7:30 h“ mit zweistelligen Minuten', () => {
    expect(formatDauer(450)).toBe('7:30 h');
    expect(formatDauer(365)).toBe('6:05 h');
  });
  it('schreibt unter einer Stunde Minuten', () => {
    expect(formatDauer(45)).toBe('45 min');
    expect(formatDauer(0)).toBe('0 min');
  });
});

describe('parseDauer (LLH-1122)', () => {
  it('liest leer als leer', () => {
    expect(parseDauer('')).toEqual({ art: 'leer' });
    expect(parseDauer('   ')).toEqual({ art: 'leer' });
    expect(parseDauer(undefined)).toEqual({ art: 'leer' });
  });
  it('liest Stunden, h:mm und Minuten', () => {
    expect(parseDauer('8')).toEqual({ art: 'minuten', minuten: 480 });
    expect(parseDauer('8 h')).toEqual({ art: 'minuten', minuten: 480 });
    expect(parseDauer('8h')).toEqual({ art: 'minuten', minuten: 480 });
    expect(parseDauer('7:30')).toEqual({ art: 'minuten', minuten: 450 });
    expect(parseDauer('7:30 h')).toEqual({ art: 'minuten', minuten: 450 });
    expect(parseDauer('0:45')).toEqual({ art: 'minuten', minuten: 45 });
    expect(parseDauer('45 min')).toEqual({ art: 'minuten', minuten: 45 });
    expect(parseDauer('90min')).toEqual({ art: 'minuten', minuten: 90 });
  });
  it('nimmt das Dezimalkomma als Stunden (7,5 = 7:30 h)', () => {
    expect(parseDauer('7,5')).toEqual({ art: 'minuten', minuten: 450 });
    expect(parseDauer('7.5 h')).toEqual({ art: 'minuten', minuten: 450 });
  });
  it('liest jede eigene Anzeige zurück', () => {
    for (const m of [0, 1, 30, 45, 60, 90, 450, 480, 720, 1440, 10_080]) {
      expect(parseDauer(formatDauer(m))).toEqual({ art: 'minuten', minuten: m });
    }
  });
  it('lehnt Unlesbares ab, statt zu raten', () => {
    for (const t of ['acht', '7:75', '7:5', '-1', '1:30:00', 'h', '8 Tage', '7,555']) {
      expect(parseDauer(t), t).toEqual({ art: 'ungueltig' });
    }
  });
});

describe('Wechselzeiten (LLH-1122)', () => {
  it('zeigt Wanduhrzeiten in der Darstellung: taktisch „0600/1800“, sonst „06:00/18:00“ (LLH-1437)', () => {
    expect(formatUhrzeiten(['06:00', '18:00'], { zeitdarstellung: 'taktisch' })).toBe('0600/1800');
    expect(formatUhrzeiten(['14:30'], {})).toBe('1430');
    expect(formatUhrzeiten(['06:00', '18:00'], { zeitdarstellung: 'datum_uhrzeit' })).toBe(
      '06:00/18:00',
    );
    expect(formatUhrzeiten(['14:30'], { zeitdarstellung: 'datum_uhrzeit' })).toBe('14:30');
  });
  it('das Feld bleibt taktisch, egal welche Darstellung gilt: „0600/1800“', () => {
    expect(uhrzeitenFeldText(['06:00', '18:00'])).toBe('0600/1800');
    expect(uhrzeitenFeldText(['14:30'])).toBe('1430');
  });
  it('liest taktisch und mit Doppelpunkt, getrennt durch Leerzeichen, Komma oder Schrägstrich', () => {
    expect(parseUhrzeiten('0600 1800')).toEqual({ art: 'zeiten', zeiten: ['06:00', '18:00'] });
    expect(parseUhrzeiten('0600/1800')).toEqual({ art: 'zeiten', zeiten: ['06:00', '18:00'] });
    expect(parseUhrzeiten('6:00, 18:00')).toEqual({ art: 'zeiten', zeiten: ['06:00', '18:00'] });
    expect(parseUhrzeiten('600')).toEqual({ art: 'zeiten', zeiten: ['06:00'] });
  });
  it('sortiert und entdoppelt wie der Server', () => {
    expect(parseUhrzeiten('1800 0600 1800')).toEqual({
      art: 'zeiten',
      zeiten: ['06:00', '18:00'],
    });
  });
  it('liest den eigenen Feldtext und beide Anzeigen zurück', () => {
    for (const text of [
      uhrzeitenFeldText(['06:00', '18:00']),
      formatUhrzeiten(['06:00', '18:00'], { zeitdarstellung: 'taktisch' }),
      formatUhrzeiten(['06:00', '18:00'], { zeitdarstellung: 'datum_uhrzeit' }),
    ]) {
      expect(parseUhrzeiten(text), text).toEqual({ art: 'zeiten', zeiten: ['06:00', '18:00'] });
    }
  });
  it('nennt die erste unlesbare Uhrzeit', () => {
    expect(parseUhrzeiten('0600 2460')).toEqual({ art: 'ungueltig', text: '2460' });
    expect(parseUhrzeiten('0600 2400')).toEqual({ art: 'ungueltig', text: '2400' });
    expect(parseUhrzeiten('abends')).toEqual({ art: 'ungueltig', text: 'abends' });
  });
  it('liest leer als leer', () => {
    expect(parseUhrzeiten('  ')).toEqual({ art: 'leer' });
  });
});
