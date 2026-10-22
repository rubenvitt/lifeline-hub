import { describe, expect, it } from 'vitest';
import { zielAusText, zielOptionen, zielVorgabe, type ZielRaum } from './zielVorschlaege';

const RAEUME: ZielRaum[] = [
  { id: 1, bezeichnung: 'BR Nord', status: 'aktiv' },
  { id: 2, bezeichnung: 'BR Süd', status: 'geplant' },
  { id: 3, bezeichnung: 'BR Alt', status: 'aufgeloest' },
];
const ABSCHNITTE = [
  { id: 7, name: 'EA Deich' },
  { id: 8, name: 'BR Süd' },
];

describe('zielOptionen', () => {
  it('nennt nicht aufgelöste Räume und Abschnitte, ein gleichnamiger Abschnitt weicht', () => {
    expect(zielOptionen(RAEUME, ABSCHNITTE)).toEqual([
      {
        label: 'Bereitstellungsräume',
        options: [
          { value: 'BR Nord', label: 'BR Nord' },
          { value: 'BR Süd', label: 'BR Süd' },
        ],
      },
      { label: 'Einsatzabschnitte', options: [{ value: 'EA Deich', label: 'EA Deich' }] },
    ]);
  });

  it('ohne Listen keine Gruppen', () => {
    expect(zielOptionen([], [])).toEqual([]);
  });
});

describe('zielVorgabe', () => {
  it('ist der einzige aktive Raum', () => {
    expect(zielVorgabe(RAEUME)).toBe('BR Nord');
  });

  it('bleibt leer bei keinem oder mehreren aktiven Räumen', () => {
    expect(zielVorgabe([])).toBe('');
    expect(zielVorgabe([...RAEUME, { id: 4, bezeichnung: 'BR Ost', status: 'aktiv' }])).toBe('');
  });
});

describe('zielAusText', () => {
  it('löst einen Raumnamen in die Kennung auf', () => {
    expect(zielAusText(' BR Nord ', RAEUME, ABSCHNITTE)).toEqual({ ziel_br_id: 1 });
  });

  it('der Raum gewinnt vor dem gleichnamigen Abschnitt', () => {
    expect(zielAusText('BR Süd', RAEUME, ABSCHNITTE)).toEqual({ ziel_br_id: 2 });
  });

  it('löst einen Abschnitt auf', () => {
    expect(zielAusText('EA Deich', RAEUME, ABSCHNITTE)).toEqual({ ziel_abschnitt_id: 7 });
  });

  it('ein aufgelöster Raum und Unbekanntes bleiben Freitext', () => {
    expect(zielAusText('BR Alt', RAEUME, ABSCHNITTE)).toEqual({ ziel_text: 'BR Alt' });
    expect(zielAusText('Lotsenpunkt Feuerwache', RAEUME, ABSCHNITTE)).toEqual({
      ziel_text: 'Lotsenpunkt Feuerwache',
    });
  });

  it('leer heißt ohne Ziel', () => {
    expect(zielAusText('  ', RAEUME, ABSCHNITTE)).toEqual({});
    expect(zielAusText(undefined, RAEUME, ABSCHNITTE)).toEqual({});
  });
});
