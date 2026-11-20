import { describe, expect, it } from 'vitest';
import {
  SCHLUESSEL_RUNDGANG,
  sollEinsatzSelbstStarten,
  sollListeSelbstStarten,
} from './rundgangSchluessel';

const stand = (eintraege: Record<string, string>) => ({ eintraege });

describe('Selbststart des Rundgangs (LLH-1990)', () => {
  it('Schlüssel spiegeln den Server', () => {
    expect(SCHLUESSEL_RUNDGANG).toEqual({
      liste: 'rundgang_liste_gesehen',
      einsatz: 'rundgang_einsatz_gesehen',
    });
  });

  it('Liste: nur bei bekanntem Stand, offener Karte und ungesehenem Teil', () => {
    expect(sollListeSelbstStarten(undefined)).toBe(false);
    expect(sollListeSelbstStarten(stand({}))).toBe(true);
    expect(sollListeSelbstStarten(stand({ willkommen_geschlossen: 'x' }))).toBe(false);
    expect(sollListeSelbstStarten(stand({ rundgang_liste_gesehen: 'x' }))).toBe(false);
  });

  it('Einsatz: nie in einem echten Einsatz', () => {
    expect(sollEinsatzSelbstStarten(stand({}), false)).toBe(false);
  });

  it('Einsatz: in einer Übung nur für Erstnutzer bei bekanntem Stand', () => {
    expect(sollEinsatzSelbstStarten(stand({}), true)).toBe(true);
    expect(sollEinsatzSelbstStarten(undefined, true)).toBe(false);
    // Kundig: Karte vor dem Update geschlossen, kein Rundgang gesehen.
    expect(sollEinsatzSelbstStarten(stand({ willkommen_geschlossen: 'x' }), true)).toBe(false);
    expect(
      sollEinsatzSelbstStarten(
        stand({ willkommen_geschlossen: 'x', rundgang_liste_gesehen: 'y' }),
        true,
      ),
    ).toBe(true);
    expect(sollEinsatzSelbstStarten(stand({ rundgang_einsatz_gesehen: 'x' }), true)).toBe(false);
  });
});
