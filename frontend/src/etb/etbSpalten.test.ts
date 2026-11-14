import { describe, expect, it } from 'vitest';
import {
  ETB_SPALTEN,
  etbZeilenform,
  vonAnAnzeige,
  vonAnTitel,
  zeitSpalteBreite,
} from './etbSpalten';

describe('vonAnAnzeige — Von → An einer Zeile', () => {
  it('zeigt Absender und Empfänger, wenn sie verschieden sind', () => {
    expect(vonAnAnzeige('Sanitätszug Musterstadt', 'EL')).toEqual({
      art: 'weg',
      von: 'Sanitätszug Musterstadt',
      an: 'EL',
    });
  });

  it('zeigt „Vermerk <Stelle>“, wenn Von und An gleich sind (Entscheidung der Einsatzleitung)', () => {
    expect(vonAnAnzeige('EL', 'EL')).toEqual({ art: 'vermerk', stelle: 'EL' });
    // Leerraum am Rand macht keine zwei Stellen.
    expect(vonAnAnzeige(' EL', 'EL ')).toEqual({ art: 'vermerk', stelle: 'EL' });
  });

  it('lässt „System → System“ weg, eine bekannte Seite bleibt', () => {
    expect(vonAnAnzeige('System', 'System')).toBeNull();
    expect(vonAnAnzeige('System', 'EL')).toEqual({ art: 'weg', von: 'System', an: 'EL' });
  });

  it('setzt für eine fehlende Seite den Strich, ohne beide nichts', () => {
    expect(vonAnAnzeige('ELW 1', null)).toEqual({ art: 'weg', von: 'ELW 1', an: '' });
    expect(vonAnAnzeige(null, undefined)).toBeNull();
    expect(vonAnAnzeige('', '  ')).toBeNull();
  });

  it('nennt den vollen Text als Titel, mit Meldeweg', () => {
    expect(vonAnTitel(vonAnAnzeige('Sanitätszug Musterstadt', 'EL'), 'Funk')).toBe(
      'Sanitätszug Musterstadt → EL · Funk',
    );
    expect(vonAnTitel(vonAnAnzeige('EL', 'EL'))).toBe('Vermerk EL');
    expect(vonAnTitel(vonAnAnzeige('ELW 1', null))).toBe('ELW 1 → —');
    expect(vonAnTitel(null, 'Funk')).toBe('Funk');
    expect(vonAnTitel(null)).toBe('');
  });
});

describe('etbZeilenform — welche Zeile auf welcher Fläche', () => {
  it('Spaltenzeile nur in kompakter Dichte ab `lg`', () => {
    expect(etbZeilenform({ schmal: false, abLg: true, kompakt: true })).toBe('spalten');
    expect(etbZeilenform({ schmal: false, abLg: false, kompakt: true })).toBe('zeitachse');
    expect(etbZeilenform({ schmal: false, abLg: true, kompakt: false })).toBe('zeitachse');
  });

  it('unter `md` in jeder Dichte die Handschirm-Zeile', () => {
    expect(etbZeilenform({ schmal: true, abLg: false, kompakt: true })).toBe('handschirm');
    expect(etbZeilenform({ schmal: true, abLg: false, kompakt: false })).toBe('handschirm');
  });
});

describe('Spaltenbreiten — eine Konstante für Kopf und Zeile', () => {
  it('trägt die Spalten in der Folge Zeit, Nr., Typ, Von → An, Inhalt, Vermerk, Menü', () => {
    expect(ETB_SPALTEN.map((s) => s.name)).toEqual([
      'Zeit',
      'Nr.',
      'Typ',
      'Von → An',
      'Inhalt',
      'Vermerk',
      '',
    ]);
  });

  it('gibt der Zeitspalte Platz für sechs Ziffern (taktisch mit Tag) bzw. „DD.MM. HH:mm“', () => {
    expect(zeitSpalteBreite({ zeitdarstellung: 'taktisch' })).toBeGreaterThanOrEqual(54);
    expect(zeitSpalteBreite({ zeitdarstellung: 'datum_uhrzeit' })).toBeGreaterThanOrEqual(108);
  });
});
