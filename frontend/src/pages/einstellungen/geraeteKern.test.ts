import dayjs from 'dayjs';
import { describe, expect, it } from 'vitest';
import {
  codeGruppiert,
  endeFehler,
  istBeendet,
  istStellengebunden,
  sperrSatz,
  verlaengernVorbelegung,
} from './geraeteKern';

const JETZT = dayjs('2026-10-04T12:00:00Z');

describe('geraeteKern (LFH-892)', () => {
  it('bindet nur Tablet und Laptop an eine UHS', () => {
    expect(istStellengebunden('uhs-tablet')).toBe(true);
    expect(istStellengebunden('uhs-laptop')).toBe(true);
    expect(istStellengebunden('lagemonitor')).toBe(false);
  });

  it('lässt eine abgelaufene Kopplung bearbeitbar, eine widerrufene nicht', () => {
    expect(istBeendet({ status: 'abgelaufen' })).toBe(false);
    expect(istBeendet({ status: 'aktiv' })).toBe(false);
    expect(istBeendet({ status: 'widerrufen' })).toBe(true);
  });

  it('nennt gesperrte Module der gewählten Ansicht, sonst nichts', () => {
    const sperren = [
      { ansicht: 'uhs-tablet' as const, gesperrte_module: ['personen'] },
      { ansicht: 'lagemonitor' as const, gesperrte_module: ['etb', 'lagekarte'] },
    ];
    const name = (k: string) => k.toUpperCase();
    expect(sperrSatz(sperren, undefined, name)).toBeNull();
    expect(sperrSatz(sperren, 'uhs-laptop', name)).toBeNull();
    expect(sperrSatz(sperren, 'uhs-tablet', name)).toBe(
      'In diesem Einsatz ist PERSONEN für einfache Mitglieder gesperrt. Ein UHS-Tablet könnte dieses Modul nicht nutzen.',
    );
    expect(sperrSatz(sperren, 'lagemonitor', name)).toBe(
      'In diesem Einsatz sind ETB, LAGEKARTE für einfache Mitglieder gesperrt. Ein Lagemonitor könnte diese Module nicht nutzen.',
    );
  });

  it('gruppiert den Code zum Vorlesen, lässt fremde Längen stehen', () => {
    expect(codeGruppiert('ABCD1234')).toBe('ABCD-1234');
    expect(codeGruppiert('ABC')).toBe('ABC');
  });

  it('belegt das Verlängern mit 24 Stunden auf die Minute vor', () => {
    expect(verlaengernVorbelegung(JETZT.add(30, 'second')).toISOString()).toBe(
      '2026-10-05T12:00:00.000Z',
    );
  });

  it('prüft das Ende wie der Server: Zukunft, höchstens 72 Stunden', () => {
    expect(endeFehler(null, JETZT)).toBe('Ende angeben');
    expect(endeFehler(JETZT, JETZT)).toBe('Das Ende muss in der Zukunft liegen');
    expect(endeFehler(JETZT.add(72, 'hour'), JETZT)).toBeNull();
    expect(endeFehler(JETZT.add(72, 'hour').add(1, 'minute'), JETZT)).toBe(
      'Höchstens 72 Stunden ab jetzt',
    );
  });
});
