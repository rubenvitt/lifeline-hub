import { describe, expect, it } from 'vitest';
import type { Staerke } from '../api/types';
import { staerkeDerEinheitImRaum, staerkeImRaum, type RaumEinheit } from './brZahlen';

const st = (fuehrer: number, unterfuehrer: number, mannschaft: number): Staerke => ({
  fuehrer,
  unterfuehrer,
  mannschaft,
});

describe('Stärke im Raum (LLH-1095 D1, LLH-1289)', () => {
  // 1. Zug (Zugtrupp 1/1/2) mit Gruppe 1 (0/1/8) und Gruppe 2 (0/1/8); Trupp unter Gruppe 1.
  const zug: RaumEinheit = { id: 10, ist: st(1, 1, 2) };
  const gruppe1: RaumEinheit = { id: 11, ueber_einheit_id: 10, ist: st(0, 1, 8) };
  const gruppe2: RaumEinheit = { id: 12, ueber_einheit_id: 10, ist: st(0, 1, 8) };
  const trupp: RaumEinheit = { id: 13, ueber_einheit_id: 11, ist: st(0, 0, 3) };
  const staffel: RaumEinheit = { id: 20, ist: st(0, 1, 5) };
  const alle = [zug, gruppe1, gruppe2, trupp, staffel];

  it('summiert die eigene Stärke der Einheiten im Raum', () => {
    expect(staerkeImRaum([10, 20], alle)).toEqual({
      staerke: st(1, 2, 7),
      unvollstaendig: false,
    });
  });

  it('zählt eine Untereinheit in einem anderen Raum nicht mit', () => {
    // Gruppe 2 steht im BR Schule: im BR Sportplatz zählen nur Zugtrupp und Gruppe 1.
    expect(staerkeImRaum([10, 11], alle).staerke).toEqual(st(1, 2, 10));
    expect(staerkeImRaum([12], alle).staerke).toEqual(st(0, 1, 8));
  });

  it('zählt jede Person genau einmal, wenn Ober- und Untereinheit im Raum stehen', () => {
    expect(staerkeImRaum([10, 11, 12, 13], alle).staerke).toEqual(st(1, 3, 21));
    expect(staerkeImRaum([11, 11], alle).staerke).toEqual(st(0, 1, 8));
  });

  it('aufgelöste Einheit trägt nichts bei', () => {
    const weg: RaumEinheit = { ...staffel, aufgeloest_at: '2026-10-31 12:00:00' };
    expect(staerkeImRaum([10, 20], [zug, weg]).staerke).toEqual(st(1, 1, 2));
    expect(staerkeImRaum([20], [weg])).toEqual({ staerke: null, unvollstaendig: false });
  });

  it('fehlende Einheit: unvollständig, keine zu kleine Zahl', () => {
    expect(staerkeImRaum([10, 99], alle)).toEqual({ staerke: null, unvollstaendig: true });
  });

  it('ohne Einheitenliste (Fehler, keine Freigabe): unvollständig', () => {
    expect(staerkeImRaum([10], undefined)).toEqual({ staerke: null, unvollstaendig: true });
  });

  it('leerer Raum: keine Stärke, aber nicht unvollständig', () => {
    expect(staerkeImRaum([], alle)).toEqual({ staerke: null, unvollstaendig: false });
    expect(staerkeImRaum([], undefined)).toEqual({ staerke: null, unvollstaendig: false });
  });
});

describe('Stärke einer Einheit im Raum (LLH-1289)', () => {
  const zug: RaumEinheit = { id: 10, ist: st(1, 1, 2) };
  const gruppe1: RaumEinheit = { id: 11, ueber_einheit_id: 10, ist: st(0, 1, 8) };
  const gruppe2: RaumEinheit = { id: 12, ueber_einheit_id: 10, ist: st(0, 1, 8) };
  const trupp: RaumEinheit = { id: 13, ueber_einheit_id: 11, ist: st(0, 0, 3) };
  const alle = [zug, gruppe1, gruppe2, trupp];

  it('Einheit samt den Untereinheiten im selben Raum', () => {
    expect(staerkeDerEinheitImRaum(10, [10, 11], alle)).toEqual(st(1, 2, 10));
  });

  it('Enkel über ein abwesendes Zwischenglied zählt zur Einheit', () => {
    // Gruppe 1 ist anderswo, ihr Trupp steht mit dem Zug im Raum.
    expect(staerkeDerEinheitImRaum(10, [10, 13], alle)).toEqual(st(1, 1, 5));
  });

  it('ohne Untereinheiten im Raum nur die eigene Stärke', () => {
    expect(staerkeDerEinheitImRaum(10, [10], alle)).toEqual(st(1, 1, 2));
    expect(staerkeDerEinheitImRaum(11, [10, 11, 12], alle)).toEqual(st(0, 1, 8));
  });

  it('fehlt die Einheit oder die Liste: keine Zahl', () => {
    expect(staerkeDerEinheitImRaum(99, [99], alle)).toBeNull();
    expect(staerkeDerEinheitImRaum(10, [10], undefined)).toBeNull();
    // Eine andere Einheit des Raums fehlt: offen, ob sie unterstellt ist, also keine Zahl.
    expect(staerkeDerEinheitImRaum(10, [10, 99], alle)).toBeNull();
  });

  it('bricht bei einem korrupten Zyklus ab', () => {
    const a: RaumEinheit = { id: 1, ueber_einheit_id: 2, ist: st(0, 0, 1) };
    const b: RaumEinheit = { id: 2, ueber_einheit_id: 1, ist: st(0, 0, 2) };
    const c: RaumEinheit = { id: 3, ueber_einheit_id: 1, ist: st(0, 0, 4) };
    expect(staerkeDerEinheitImRaum(1, [1, 2, 3], [a, b, c])).toEqual(st(0, 0, 7));
  });
});
