import { describe, expect, it } from 'vitest';
import { theme } from 'antd';
import {
  faerbeHochwasser,
  hochwasserRadius,
  hochwasserDarstellung,
} from './hochwasserStil';
import { antdToken, farbenDunkel, farbenHell, type Farbrollen } from '../../theme/tokens';
import type { FeatureCollection } from '../../api/fachebenen';

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
      properties: klasse === undefined ? { titel: `P${i}` } : { titel: `P${i}`, klasse },
    })),
  } as FeatureCollection;
}

describe('hochwasserRadius', () => {
  it('macht jede gemeldete Klasse größer als jede nicht gemeldete', () => {
    // DIE eigentliche Zusicherung der Ebene: ein Kreis trägt keine Beschriftung, der
    // Durchmesser ist der zweite Kanal neben der Rolle (WCAG 1.4.1).
    const gemeldet = ['klein', 'mittel', 'gross', 'sehr_gross'] as const;
    const stumm = ['kein_hochwasser', 'keine_daten', 'unklassifiziert'] as const;
    for (const g of gemeldet) {
      for (const s of stumm) {
        expect(hochwasserRadius(g), `${g} gegen ${s}`).toBeGreaterThan(hochwasserRadius(s));
      }
    }
  });

  it('wächst über die vier Meldeklassen streng monoton', () => {
    expect(hochwasserRadius('klein')).toBeLessThan(hochwasserRadius('mittel'));
    expect(hochwasserRadius('mittel')).toBeLessThan(hochwasserRadius('gross'));
    expect(hochwasserRadius('gross')).toBeLessThan(hochwasserRadius('sehr_gross'));
  });
});

describe('faerbeHochwasser', () => {
  it('schreibt Farbe und Radius in die Properties, ohne Bestehendes zu verlieren', () => {
    const f = faerbeHochwasser(fc(['gross']), hell).features[0];
    expect(f.properties.farbe).toBe(hell.colorError);
    expect(f.properties.radius).toBe(hochwasserRadius('gross'));
    expect(f.properties.titel).toBe('P0');
    expect(f.geometry?.coordinates).toEqual([8, 50]);
  });

  it('löst die Farbe im aktiven Modus auf, statt einen Festwert zu tragen', () => {
    const h = faerbeHochwasser(fc(['klein']), hell).features[0].properties.farbe;
    const d = faerbeHochwasser(fc(['klein']), dunkel).features[0].properties.farbe;
    expect(h).not.toBe(d);
  });

  it('behandelt eine fehlende oder unbekannte Klasse wie „keine Daten"', () => {
    const gefaerbt = faerbeHochwasser(fc([undefined, 'quatsch']), hell).features;
    for (const f of gefaerbt) {
      expect(f.properties.farbe).toBe(hell.colorTextTertiary);
      expect(f.properties.radius).toBe(hochwasserRadius('keine_daten'));
    }
  });
});

describe('hochwasserDarstellung', () => {
  it('gibt Rolle und Vertragswort zurück', () => {
    expect(hochwasserDarstellung('sehr_gross')).toEqual({
      rolle: 'alarm',
      label: 'sehr großes Hochwasser',
    });
  });

  it('fällt bei unbekanntem Wert auf „keine Daten" zurück, statt den Rohwert zu zeigen', () => {
    expect(hochwasserDarstellung('quatsch').label).toBe('keine Daten');
  });
});
