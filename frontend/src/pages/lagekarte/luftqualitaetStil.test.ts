import { describe, expect, it } from 'vitest';
import { theme } from 'antd';
import {
  faerbeLuftqualitaet,
  luftqualitaetDarstellung,
  luftqualitaetRadius,
} from './luftqualitaetStil';
import { antdToken, farbenDunkel, farbenHell, type Farbrollen } from '../../theme/tokens';
import type { FeatureCollection, LuftqualitaetKlasse } from '../../api/fachebenen';

function tokenFuer(farben: Farbrollen, dunkel: boolean) {
  return theme.getDesignToken({
    algorithm: dunkel ? theme.darkAlgorithm : theme.defaultAlgorithm,
    token: antdToken(farben),
  });
}
const hell = tokenFuer(farbenHell, false);
const dunkel = tokenFuer(farbenDunkel, true);

function fc(klassen: (string | undefined)[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: klassen.map((klasse, i) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [8 + i, 50] },
      properties: klasse === undefined ? { titel: `S${i}` } : { titel: `S${i}`, klasse },
    })),
  } as FeatureCollection;
}

describe('luftqualitaetRadius', () => {
  it('wächst mit der Stufe streng monoton — auch innerhalb einer Rolle', () => {
    // Der Radius ist der zweite Kanal (WCAG 1.4.1): `sehr_gut`/`gut` und
    // `schlecht`/`sehr_schlecht` teilen sich je eine Rolle und wären sonst gleich.
    const reihe: LuftqualitaetKlasse[] = [
      'keine_daten',
      'sehr_gut',
      'gut',
      'maessig',
      'schlecht',
      'sehr_schlecht',
    ];
    for (let i = 1; i < reihe.length; i++) {
      expect(luftqualitaetRadius(reihe[i]), `${reihe[i]} > ${reihe[i - 1]}`).toBeGreaterThan(
        luftqualitaetRadius(reihe[i - 1]),
      );
    }
  });
});

describe('luftqualitaetDarstellung', () => {
  it('fällt auch bei Namen aus der Prototypkette auf „keine Daten" zurück', () => {
    // `roh in karte` sähe `constructor`/`toString` als Schlüssel und gäbe die
    // Object-Funktion statt einer Darstellung zurück.
    for (const roh of ['constructor', 'toString', '__proto__']) {
      expect(luftqualitaetDarstellung(roh).label, roh).toBe('keine Daten');
    }
  });

  it('liefert das Wort der Stufe', () => {
    expect(luftqualitaetDarstellung('maessig').label).toBe('mäßig');
  });

  it('zeigt einen unbekannten oder fehlenden Wert als „keine Daten", nie als Rohwert', () => {
    expect(luftqualitaetDarstellung('katastrophal').label).toBe('keine Daten');
    expect(luftqualitaetDarstellung(undefined).label).toBe('keine Daten');
    expect(luftqualitaetDarstellung(3).label).toBe('keine Daten');
  });
});

describe('faerbeLuftqualitaet', () => {
  it('backt Farbe und Radius je Stufe ein und lässt Geometrie und Properties stehen', () => {
    const aus = faerbeLuftqualitaet(fc(['sehr_schlecht', 'sehr_gut']), hell);
    const [schlecht, gut] = aus.features;
    expect(schlecht.properties.radius).toBe(luftqualitaetRadius('sehr_schlecht'));
    expect(gut.properties.radius).toBe(luftqualitaetRadius('sehr_gut'));
    expect(schlecht.properties.farbe).not.toBe(gut.properties.farbe);
    expect(schlecht.properties.titel).toBe('S0');
    expect(schlecht.geometry).toEqual({ type: 'Point', coordinates: [8, 50] });
  });

  it('löst die Farbe aus dem aktiven Modus auf', () => {
    const h = faerbeLuftqualitaet(fc(['schlecht']), hell).features[0].properties.farbe;
    const d = faerbeLuftqualitaet(fc(['schlecht']), dunkel).features[0].properties.farbe;
    expect(typeof h).toBe('string');
    expect(h).not.toBe(d);
  });

  it('behandelt ein Feature ohne Stufe wie „keine Daten"', () => {
    const [f] = faerbeLuftqualitaet(fc([undefined]), hell).features;
    expect(f.properties.radius).toBe(luftqualitaetRadius('keine_daten'));
  });
});
