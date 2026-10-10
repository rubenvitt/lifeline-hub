import dayjs from 'dayjs';
import { describe, expect, it } from 'vitest';
import {
  codeGruppiert,
  endeFehler,
  istBeendet,
  sperrSatz,
  stellenartVon,
  stellenOptionen,
  verlaengernVorbelegung,
} from './geraeteKern';

const JETZT = dayjs('2026-10-04T12:00:00Z');

describe('geraeteKern (LFH-892)', () => {
  it('nimmt die Stellenart aus der Übersicht des Servers', () => {
    const ansichten = [
      { ansicht: 'uhs-tablet' as const, stellenart: 'uhs' as const },
      { ansicht: 'lagemonitor' as const, stellenart: null },
    ];
    expect(stellenartVon(ansichten, 'uhs-tablet')).toBe('uhs');
    expect(stellenartVon(ansichten, 'lagemonitor')).toBeNull();
    // Nicht angeboten (noch nicht verfügbar) oder nichts gewählt: keine Stelle.
    expect(stellenartVon(ansichten, 'betreuungsstelle')).toBeNull();
    expect(stellenartVon(ansichten, undefined)).toBeNull();
  });

  it('bietet je Stellenart nur Stellen an, die der Server annimmt', () => {
    const quellen = {
      uhs: [
        { id: 1, bezeichnung: 'UHS Nord', status: 'aktiv' },
        { id: 2, bezeichnung: 'UHS Süd', status: 'aufgeloest' },
        { id: 3, bezeichnung: 'UHS Ost', status: 'geplant', storniert_at: '2026-10-08 10:00:00' },
      ],
      betreuungsstellen: [
        { id: 4, bezeichnung: 'Turnhalle' },
        { id: 5, bezeichnung: 'Schule', storniert_at: '2026-10-08 10:00:00' },
      ],
      bereitstellungsraeume: [
        { id: 6, bezeichnung: 'BR 1', status: 'geplant' },
        { id: 7, bezeichnung: 'BR 2', status: 'aufgeloest' },
      ],
      abschnitte: [{ id: 8, name: 'EA Nord' }],
    };
    expect(stellenOptionen(quellen, 'uhs')).toEqual([{ value: 1, label: 'UHS Nord' }]);
    expect(stellenOptionen(quellen, 'betreuungsstelle')).toEqual([
      { value: 4, label: 'Turnhalle' },
    ]);
    expect(stellenOptionen(quellen, 'bereitstellungsraum')).toEqual([{ value: 6, label: 'BR 1' }]);
    expect(stellenOptionen(quellen, 'einsatzabschnitt')).toEqual([{ value: 8, label: 'EA Nord' }]);
    expect(stellenOptionen({}, 'uhs')).toEqual([]);
  });

  it('lässt eine laufende Kopplung bearbeitbar, eine abgelaufene oder widerrufene nicht (LFH-1143)', () => {
    expect(istBeendet({ status: 'wartend' })).toBe(false);
    expect(istBeendet({ status: 'aktiv' })).toBe(false);
    expect(istBeendet({ status: 'abgelaufen' })).toBe(true);
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
      'PERSONEN für einfache Mitglieder gesperrt – fehlt auf dem UHS-Tablet',
    );
    expect(sperrSatz(sperren, 'lagemonitor', name)).toBe(
      'ETB, LAGEKARTE für einfache Mitglieder gesperrt – fehlen auf dem Lagemonitor',
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
