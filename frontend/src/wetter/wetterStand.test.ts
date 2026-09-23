import { describe, expect, it } from 'vitest';
import {
  VERALTET_AB_MS,
  dreiStundenTakt,
  himmelsrichtung,
  teileWarnungen,
  teilStand,
} from './wetterStand';

const BERLIN = { zeitzone: 'Europe/Berlin' };
/** 2026-09-22 12:30:00 UTC = 14:30 Berlin. */
const JETZT = Date.UTC(2026, 8, 22, 12, 30, 0);
const vor = (ms: number) => new Date(JETZT - ms).toISOString();
const MIN = 60_000;

describe('teilStand', () => {
  it('ok und jung: aktuell mit „Stand HH:MM"', () => {
    expect(
      teilStand({ zustand: 'ok', abgerufen_at: vor(5 * MIN) }, 'warnungen', JETZT, BERLIN),
    ).toEqual({ art: 'aktuell', stand: 'Stand 14:25' });
  });

  it('Warnungen: genau 30 min ist noch aktuell, 30 min + 1 s ist veraltet', () => {
    expect(VERALTET_AB_MS.warnungen).toBe(30 * MIN);
    expect(
      teilStand({ zustand: 'ok', abgerufen_at: vor(30 * MIN) }, 'warnungen', JETZT, BERLIN).art,
    ).toBe('aktuell');
    expect(
      teilStand({ zustand: 'ok', abgerufen_at: vor(30 * MIN + 1000) }, 'warnungen', JETZT, BERLIN),
    ).toEqual({ art: 'veraltet', stand: 'Stand 13:59' });
  });

  it('Vorhersage: die Schwelle liegt bei 3 h', () => {
    expect(VERALTET_AB_MS.vorhersage).toBe(180 * MIN);
    expect(
      teilStand({ zustand: 'ok', abgerufen_at: vor(180 * MIN) }, 'vorhersage', JETZT, BERLIN).art,
    ).toBe('aktuell');
    expect(
      teilStand({ zustand: 'ok', abgerufen_at: vor(181 * MIN) }, 'vorhersage', JETZT, BERLIN).art,
    ).toBe('veraltet');
  });

  it('Ausfall und unlesbarer Stand sind „Stand unbekannt"; kein Ort bleibt eigener Zustand', () => {
    expect(teilStand({ zustand: 'ausfall' }, 'warnungen', JETZT, BERLIN)).toEqual({
      art: 'unbekannt',
      stand: 'Stand unbekannt',
    });
    expect(
      teilStand({ zustand: 'ok', abgerufen_at: 'kaputt' }, 'warnungen', JETZT, BERLIN).art,
    ).toBe('unbekannt');
    expect(teilStand({ zustand: 'ok' }, 'warnungen', JETZT, BERLIN).art).toBe('unbekannt');
    expect(teilStand({ zustand: 'kein_ort' }, 'warnungen', JETZT, BERLIN)).toEqual({
      art: 'kein_ort',
      stand: null,
    });
  });
});

describe('teileWarnungen', () => {
  it('Beginn ≤ jetzt oder unbekannt gilt jetzt, späterer Beginn ist angekündigt; Ordnung bleibt', () => {
    const a = { id: 'a', beginn: vor(60 * MIN) };
    const b = { id: 'b', beginn: new Date(JETZT).toISOString() };
    const c = { id: 'c', beginn: new Date(JETZT + 1000).toISOString() };
    const d = { id: 'd', beginn: null };
    const { giltJetzt, angekuendigt } = teileWarnungen([c, a, d, b], JETZT);
    expect(giltJetzt.map((w) => w.id)).toEqual(['a', 'd', 'b']);
    expect(angekuendigt.map((w) => w.id)).toEqual(['c']);
  });
});

describe('dreiStundenTakt', () => {
  it('nimmt ab der ersten Stunde jede dritte, höchstens 8 (24 h)', () => {
    const stunden = Array.from({ length: 25 }, (_, i) => ({
      zeitpunkt: new Date(Date.UTC(2026, 8, 22, 13 + i)).toISOString(),
    }));
    const auswahl = dreiStundenTakt(stunden);
    expect(auswahl).toHaveLength(8);
    expect(auswahl[0]).toBe(stunden[0]);
    expect(auswahl[1]).toBe(stunden[3]);
    expect(auswahl[7]).toBe(stunden[21]);
  });

  it('eine Lücke in der Reihe verschiebt den Takt nicht (nach Zeit, nicht nach Index)', () => {
    const t = (h: number) => ({ zeitpunkt: new Date(Date.UTC(2026, 8, 22, h)).toISOString() });
    const auswahl = dreiStundenTakt([t(12), t(14), t(15), t(18)]);
    expect(auswahl.map((s) => s.zeitpunkt)).toEqual([t(12), t(15), t(18)].map((s) => s.zeitpunkt));
  });

  it('leer bleibt leer', () => {
    expect(dreiStundenTakt([])).toEqual([]);
  });
});

describe('himmelsrichtung', () => {
  it('acht Sektoren, 0° und 359° sind Nord, null bleibt null', () => {
    expect(himmelsrichtung(0)).toBe('N');
    expect(himmelsrichtung(359)).toBe('N');
    expect(himmelsrichtung(45)).toBe('NO');
    expect(himmelsrichtung(90)).toBe('O');
    expect(himmelsrichtung(135)).toBe('SO');
    expect(himmelsrichtung(180)).toBe('S');
    expect(himmelsrichtung(225)).toBe('SW');
    expect(himmelsrichtung(270)).toBe('W');
    expect(himmelsrichtung(315)).toBe('NW');
    expect(himmelsrichtung(null)).toBeNull();
    expect(himmelsrichtung(undefined)).toBeNull();
  });
});
