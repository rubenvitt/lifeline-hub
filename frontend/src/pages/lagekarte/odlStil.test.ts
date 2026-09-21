import { describe, expect, it } from 'vitest';
import { theme } from 'antd';
import { faerbeOdl, odlDarstellung, odlGrundlage, odlRadius } from './odlStil';
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

function fc(stufen: (string | undefined)[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: stufen.map((stufe, i) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [8 + i, 50] },
      properties: stufe === undefined ? { titel: `S${i}` } : { titel: `S${i}`, stufe },
    })),
  } as FeatureCollection;
}

describe('odlRadius', () => {
  it('wächst über die vier Stufen streng monoton', () => {
    // Der Durchmesser ist der zweite Kanal neben der Rolle (WCAG 1.4.1): ein Kreis trägt
    // keine Beschriftung, und eine erhöhte Sonde muss zwischen ~1 600 normalen heraustreten.
    expect(odlRadius('keine_messung')).toBeLessThan(odlRadius('normal'));
    expect(odlRadius('normal')).toBeLessThan(odlRadius('erhoeht'));
    expect(odlRadius('erhoeht')).toBeLessThan(odlRadius('stark_erhoeht'));
  });
});

describe('faerbeOdl', () => {
  it('schreibt Farbe und Radius in die Properties, ohne Bestehendes zu verlieren', () => {
    const f = faerbeOdl(fc(['stark_erhoeht']), hell).features[0];
    expect(f.properties.farbe).toBe(hell.colorError);
    expect(f.properties.radius).toBe(odlRadius('stark_erhoeht'));
    expect(f.properties.titel).toBe('S0');
    expect(f.geometry?.coordinates).toEqual([8, 50]);
  });

  it('färbt jede Stufe in ihrer Vertragsrolle', () => {
    const farben = faerbeOdl(fc(['normal', 'erhoeht', 'stark_erhoeht']), hell).features.map(
      (f) => f.properties.farbe,
    );
    expect(farben).toEqual([hell.colorSuccess, hell.colorWarning, hell.colorError]);
  });

  it('löst die Farbe im aktiven Modus auf, statt einen Festwert zu tragen', () => {
    const h = faerbeOdl(fc(['erhoeht']), hell).features[0].properties.farbe;
    const d = faerbeOdl(fc(['erhoeht']), dunkel).features[0].properties.farbe;
    expect(h).not.toBe(d);
  });

  it('erfindet für ein unbekanntes oder fehlendes Wort keine Bewertung', () => {
    const [unbekannt, fehlt] = faerbeOdl(fc(['radioaktiv', undefined]), hell).features;
    expect(unbekannt.properties.radius).toBe(odlRadius('keine_messung'));
    expect(fehlt.properties.radius).toBe(odlRadius('keine_messung'));
  });
});

describe('odlDarstellung', () => {
  it('liest die Wire-Wörter wörtlich (Gegenstück zu karte::normalisierung::odl_tests)', () => {
    expect(odlDarstellung('keine_messung').label).toBe('keine Messung');
    expect(odlDarstellung('normal').label).toBe('unauffällig');
    expect(odlDarstellung('erhoeht').label).toBe('erhöht');
    expect(odlDarstellung('stark_erhoeht').label).toBe('stark erhöht');
  });

  it('lässt einen Rohwert nicht in die Oberfläche', () => {
    expect(odlDarstellung('stark-erhoeht').label).toBe('keine Messung');
    expect(odlDarstellung(0.7).label).toBe('keine Messung');
  });
});

describe('odlGrundlage (LFH-598)', () => {
  it('liest `standort` samt Grundpegel, Faktor und Stand', () => {
    // LITERAL: das Wort ist gegenüber `karte::odl_grundpegel::tests` gepinnt.
    expect(
      odlGrundlage({
        bewertung: 'standort',
        grundpegel: 0.06,
        faktor: 3.17,
        grundpegel_stand: '2026-09-21T12:00:00Z',
      }),
    ).toEqual({ art: 'standort', grundpegel: 0.06, faktor: 3.17, stand: '2026-09-21T12:00:00Z' });
  });

  it('liest `absolut` als absolut', () => {
    // LITERAL, zweites Wort des Vertrags.
    expect(odlGrundlage({ bewertung: 'absolut' })).toEqual({ art: 'absolut' });
  });

  it('erfindet keinen Maßstab: unbekanntes Wort, fehlende Felder, keine Properties', () => {
    for (const p of [
      { bewertung: 'relativ', grundpegel: 0.1, faktor: 2 },
      { bewertung: 'standort', faktor: 2 },
      { bewertung: 'standort', grundpegel: '0.1', faktor: 2 },
      { grundpegel: 0.1, faktor: 2 },
      undefined,
    ]) {
      expect(odlGrundlage(p)).toEqual({ art: 'absolut' });
    }
  });
});
