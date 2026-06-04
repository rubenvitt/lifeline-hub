import { describe, expect, it } from 'vitest';
import { GEFAHRENTYPEN, SCHUTZOBJEKTE, WARNSTUFEN, kombinationGueltig, warnstufeFarbe } from './gefahrenSchema';

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
    // gültige Beispiele
    expect(kombinationGueltig('brand', 'menschen')).toBe(true);
    expect(kombinationGueltig('atemgifte', 'umwelt')).toBe(true);
    expect(kombinationGueltig('brand', 'sachwerte')).toBe(true);
  });

  it('warnstufeFarbe liefert für jede Warnstufe einen Wert', () => {
    for (const w of WARNSTUFEN) {
      expect(typeof warnstufeFarbe(w.wert)).toBe('string');
    }
  });
});
