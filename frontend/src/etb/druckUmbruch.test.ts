import { describe, expect, it } from 'vitest';
import { UEBERLANG_AB_ZEILEN, geschaetzteDruckzeilen, istUeberlang } from './druckUmbruch';

/**
 * Ab wann eine ETB-Zeile im Druck frei umbricht (LFH-1009). Die Wirkung auf dem Blatt belegt
 * `e2e/etb-druck.spec.ts` („überlanger Eintrag"); hier steht die Schwelle.
 */

const SATZ =
  'Die Lage im Einsatzabschnitt hat sich seit der letzten Meldung verändert, die Kräfte vor Ort ' +
  'melden eine Ausweitung des Schadensgebiets nach Nordosten. ';

describe('druckUmbruch', () => {
  it('zählt jede Quellzeile mindestens einmal, lange Zeilen nach Spaltenbreite', () => {
    expect(geschaetzteDruckzeilen('Kurz')).toBe(1);
    expect(geschaetzteDruckzeilen('a\n\nb')).toBe(3);
    expect(geschaetzteDruckzeilen('x'.repeat(37))).toBe(2);
  });

  it('hält eine gewöhnliche Meldung zusammen', () => {
    expect(istUeberlang('Florian 1 meldet: Deich Nord hält, Pegel 4,20 m, fallend.')).toBe(false);
    expect(istUeberlang(Array.from({ length: 3 }, () => SATZ.repeat(2)).join('\n\n'))).toBe(false);
  });

  it('lässt einen freigegebenen Lagebericht umbrechen', () => {
    const abschnitt = (titel: string) =>
      [`## ${titel}`, ...Array.from({ length: 6 }, () => SATZ.repeat(2))].join('\n\n');
    expect(istUeberlang(['Auftrag', 'Eigene Lage'].map(abschnitt).join('\n\n'))).toBe(true);
  });

  it('kippt an der Schwelle', () => {
    const zeilen = (n: number) => Array.from({ length: n }, () => 'Zeile').join('\n');
    expect(istUeberlang(zeilen(UEBERLANG_AB_ZEILEN - 1))).toBe(false);
    expect(istUeberlang(zeilen(UEBERLANG_AB_ZEILEN))).toBe(true);
  });
});
