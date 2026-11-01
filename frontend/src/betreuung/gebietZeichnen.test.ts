import { describe, expect, it } from 'vitest';
import { gebietZeichnenPfad, gebietZeichnenText } from './gebietZeichnen';

describe('gebietZeichnen (LLH-1069)', () => {
  it('Wortlaut nach Flächenzahl', () => {
    expect(gebietZeichnenText(0)).toBe('Gebiet zeichnen');
    expect(gebietZeichnenText(1)).toBe('Weitere Teilfläche zeichnen');
    expect(gebietZeichnenText(3)).toBe('Weitere Teilfläche zeichnen');
  });
  it('Ziel: Lagekarte im Zeichenmodus mit Bezug', () => {
    expect(gebietZeichnenPfad(1, 5)).toBe(
      '/einsaetze/1/lagekarte?zeichnen=evakuierungsbezirk&bezirk=5',
    );
  });
  it('Ziel mit Kreis (LLH-1346): Form, Radius, Mitte und Bezug in einem Link', () => {
    expect(gebietZeichnenPfad(1, 5, { radius: 500, mitte: { lat: 54.123456, lon: 9.5 } })).toBe(
      '/einsaetze/1/lagekarte?zeichnen=evakuierungsbezirk%3Akreis&radius=500&mitte=54.12346%2C9.5&bezirk=5',
    );
  });
  it('Kreis ohne bekannte Mitte: nur der Radius ist vorbelegt', () => {
    expect(gebietZeichnenPfad(1, 5, { radius: 300 })).toBe(
      '/einsaetze/1/lagekarte?zeichnen=evakuierungsbezirk%3Akreis&radius=300&bezirk=5',
    );
  });
});
