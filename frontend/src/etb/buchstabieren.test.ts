import { describe, expect, it } from 'vitest';
import { buchstabiere } from './buchstabieren';

describe('buchstabiere', () => {
  it('buchstabiert Text mit der klassischen deutschen Tafel (DIN 5009)', () => {
    expect(buchstabiere('Florian').map((z) => z.wort)).toEqual([
      'Friedrich', 'Ludwig', 'Otto', 'Richard', 'Ida', 'Anton', 'Nordpol',
    ]);
  });

  it('unterstützt die NATO-Umschaltung', () => {
    expect(buchstabiere('AB', 'nato').map((z) => z.wort)).toEqual(['Alfa', 'Bravo']);
  });

  it('buchstabiert Umlaute und Ziffern (klassisch)', () => {
    expect(buchstabiere('Ä3', 'din5009').map((z) => z.wort)).toEqual(['Ärger', 'Drei']);
  });

  it('reicht unbekannte Zeichen (Leerzeichen, Sonderzeichen) als wort=null durch', () => {
    expect(buchstabiere('A/1')).toEqual([
      { zeichen: 'A', wort: 'Anton' },
      { zeichen: '/', wort: null },
      { zeichen: '1', wort: 'Eins' },
    ]);
  });

  it('liefert für leeren Text ein leeres Ergebnis', () => {
    expect(buchstabiere('')).toEqual([]);
  });
});
