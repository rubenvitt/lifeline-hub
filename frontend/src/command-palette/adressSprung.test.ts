import { describe, expect, it } from 'vitest';
import { GRUPPE_MERKBAR } from './typen';
import { adressBefehl, istAdressEingabe } from './adressSprung';

describe('istAdressEingabe (LFH-638)', () => {
  it('ab drei Zeichen mit einem Buchstaben', () => {
    expect(istAdressEingabe('Hauptstraße 12')).toBe(true);
    expect(istAdressEingabe('Ulm')).toBe(true);
  });

  it('zu kurz, ohne Buchstaben oder eine Koordinate ist keine Adresse', () => {
    expect(istAdressEingabe('Ha')).toBe(false);
    expect(istAdressEingabe('  ')).toBe(false);
    expect(istAdressEingabe('1234')).toBe(false);
    expect(istAdressEingabe('#42')).toBe(false);
    expect(istAdressEingabe('51.16040, 10.45140')).toBe(false);
  });
});

describe('adressBefehl (LFH-638)', () => {
  it('springt mit ?ort= auf die Lagekarte, nennt den Text und ist nicht merkbar', () => {
    const ziele: { pfad: string; oeffnung?: string }[] = [];
    const b = adressBefehl({
      einsatzId: 5,
      text: 'Hauptstraße 12',
      navigate: (pfad, oeffnung) => ziele.push({ pfad, oeffnung }),
    });
    expect(b.label).toBe('Adresse auf Lagekarte suchen · „Hauptstraße 12“');
    expect(b.gruppe).toBe('ortssuche');
    expect(GRUPPE_MERKBAR[b.gruppe]).toBe(false);
    expect(b.vorschau).toBeUndefined();
    b.ausfuehren();
    b.ausfuehren('neuerTab');
    const url = new URL(ziele[0].pfad, 'http://x');
    expect(url.pathname).toBe('/einsaetze/5/lagekarte');
    expect(url.searchParams.get('ort')).toBe('Hauptstraße 12');
    expect(ziele[1].oeffnung).toBe('neuerTab');
    expect(b.ziel).toBeDefined();
  });

  it('die id trägt den Text — beim Weitertippen klebt keine Markierung an einem alten Begriff', () => {
    const nav = () => {};
    expect(adressBefehl({ einsatzId: 5, text: 'Haupt', navigate: nav }).id).not.toBe(
      adressBefehl({ einsatzId: 5, text: 'Hauptstraße', navigate: nav }).id,
    );
  });
});
