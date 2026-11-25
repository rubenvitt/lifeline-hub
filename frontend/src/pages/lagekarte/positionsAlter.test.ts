import { describe, expect, it } from 'vitest';
import { positionsAlter } from './positionsAlter';

const jetzt = new Date('2026-11-24T12:10:00Z');

describe('positionsAlter (Helfer-App, „veraltet“ ab 5 min)', () => {
  it('ohne Zeitpunkt gibt es kein Alter', () => {
    expect(positionsAlter(null, jetzt)).toBeNull();
  });

  it('4 min sind frisch', () => {
    expect(positionsAlter('2026-11-24 12:06:00', jetzt)).toEqual({ minuten: 4, veraltet: false });
  });

  it('6 min sind veraltet', () => {
    expect(positionsAlter('2026-11-24 12:04:00', jetzt)).toEqual({ minuten: 6, veraltet: true });
  });

  it('ab genau 5 min veraltet, angebrochene Minuten zählen nicht', () => {
    expect(positionsAlter('2026-11-24 12:05:00', jetzt)?.veraltet).toBe(true);
    expect(positionsAlter('2026-11-24 12:05:01', jetzt)).toEqual({ minuten: 4, veraltet: false });
  });

  it('liest den Zeitpunkt als UTC, auch mit Zonenkennung', () => {
    expect(positionsAlter('2026-11-24T12:04:00Z', jetzt)?.minuten).toBe(6);
  });

  it('ein Zeitpunkt in der Zukunft ist 0 min alt, ein unlesbarer keiner', () => {
    expect(positionsAlter('2026-11-24 12:11:00', jetzt)).toEqual({ minuten: 0, veraltet: false });
    expect(positionsAlter('kaputt', jetzt)).toBeNull();
  });
});
