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
});
