import { describe, expect, it } from 'vitest';
import {
  GEFAHRENTYPEN,
  GEFAHRENTYPEN_ALPHABETISCH,
  SCHUTZOBJEKTE,
  WARNSTUFEN,
  kombinationGueltig,
  sortGefahrenAlphabetisch,
} from './gefahrenSchema';

describe('gefahrenSchema', () => {
  it('hat 13 Gefahrentypen, 5 Schutzobjekte, 5 Warnstufen', () => {
    expect(GEFAHRENTYPEN).toHaveLength(13);
    expect(SCHUTZOBJEKTE).toHaveLength(5);
    expect(WARNSTUFEN).toHaveLength(5);
  });

  it('kombinationGueltig sperrt die ungültigen Paare', () => {
    // sachwerte × {angstreaktion, atemgifte, erkrankung_verletzung, ertrinken}
    expect(kombinationGueltig('atemgifte', 'sachwerte')).toBe(false);
    expect(kombinationGueltig('angstreaktion', 'sachwerte')).toBe(false);
    expect(kombinationGueltig('erkrankung_verletzung', 'sachwerte')).toBe(false);
    expect(kombinationGueltig('ertrinken', 'sachwerte')).toBe(false);
    // umwelt × {angstreaktion, erkrankung_verletzung, ertrinken}
    expect(kombinationGueltig('angstreaktion', 'umwelt')).toBe(false);
    expect(kombinationGueltig('erkrankung_verletzung', 'umwelt')).toBe(false);
    expect(kombinationGueltig('ertrinken', 'umwelt')).toBe(false);
    expect(kombinationGueltig('brand', 'menschen')).toBe(true);
    expect(kombinationGueltig('atemgifte', 'umwelt')).toBe(true);
    expect(kombinationGueltig('brand', 'sachwerte')).toBe(true);
  });

  /**
   * LLH-1102: angezeigt wird alphabetisch nach deutscher Kollation, überall dieselbe Folge (Matrix,
   * Lagebild, Palettenauszug, Schäden). Der Katalog `GEFAHRENTYPEN` bleibt die Backend-Folge.
   */
  it('sortiert die Gefahrentypen für die Anzeige alphabetisch, der Katalog bleibt', () => {
    expect(GEFAHRENTYPEN_ALPHABETISCH.map((g) => g.label)).toEqual([
      'Absturz',
      'Angstreaktion',
      'Atemgifte',
      'Atomare Strahlung',
      'Ausbreitung',
      'Brand',
      'Chemische Stoffe',
      'Durchbruch',
      'Einsturz',
      'Elektrizität',
      'Erkrankung/Verletzung',
      'Ertrinken',
      'Explosion',
    ]);
    expect(GEFAHRENTYPEN[0].wert).toBe('atemgifte');
    // Deutsche Kollation: der Umlaut steht beim Grundbuchstaben, nicht hinter „z“.
    expect(
      sortGefahrenAlphabetisch([{ label: 'Zone' }, { label: 'Übergang' }, { label: 'Ufer' }]).map(
        (e) => e.label,
      ),
    ).toEqual(['Übergang', 'Ufer', 'Zone']);
  });

  // Die Farbskala liegt in `theme/statusFarben.ts` und ist dort gepinnt — nicht hier nachbauen.
});
