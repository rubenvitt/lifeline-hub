import { describe, expect, it } from 'vitest';
import {
  SCHLUESSEL_ETB_STANDARD_RUFNAME,
  anWieVon,
  ausStandard,
  fehlendeSeite,
  leseStandardRufname,
  standardRufnameWert,
  wirksameMetadaten,
} from './standardRufname';

const stand = (wert: string) => ({ eintraege: { [SCHLUESSEL_ETB_STANDARD_RUFNAME]: wert } });

describe('leseStandardRufname', () => {
  it('liest beide Seiten getrimmt', () => {
    expect(leseStandardRufname(stand('{"von":" ELW 1 ","an":"Einsatzleitung"}'))).toEqual({
      von: 'ELW 1',
      an: 'Einsatzleitung',
    });
  });

  it.each([
    ['kein Fach', undefined],
    ['kein Schlüssel', { eintraege: {} }],
    ['ungültiges JSON', stand('{von')],
    ['falsche Form', stand('42')],
    ['null', stand('null')],
    ['Zahl statt Text', stand('{"von":1,"an":"ELW 1"}')],
    ['leere Seite', stand('{"von":"ELW 1","an":"  "}')],
  ])('%s → kein Standard', (_, s) => {
    expect(leseStandardRufname(s)).toBeNull();
  });
});

describe('standardRufnameWert', () => {
  it('schreibt bei „Empfänger wie Absender“ An = Von', () => {
    expect(standardRufnameWert(' ELW 1 ', 'egal', true)).toBe('{"von":"ELW 1","an":"ELW 1"}');
  });

  it('schreibt getrennte Seiten', () => {
    expect(standardRufnameWert('ELW 1', 'Einsatzleitung', false)).toBe(
      '{"von":"ELW 1","an":"Einsatzleitung"}',
    );
  });

  it('verweigert eine leere Seite', () => {
    expect(standardRufnameWert('  ', '', true)).toBeNull();
    expect(standardRufnameWert('ELW 1', ' ', false)).toBeNull();
  });

  it('der geschriebene Wert liest sich zurück', () => {
    const wert = standardRufnameWert('ELW 1', 'S2', false)!;
    expect(leseStandardRufname(stand(wert))).toEqual({ von: 'ELW 1', an: 'S2' });
  });
});

describe('anWieVon', () => {
  it('ohne Standard und bei gleichen Seiten an, sonst aus', () => {
    expect(anWieVon(null)).toBe(true);
    expect(anWieVon({ von: 'ELW 1', an: 'ELW 1' })).toBe(true);
    expect(anWieVon({ von: 'ELW 1', an: 'S2' })).toBe(false);
  });
});

describe('wirksameMetadaten', () => {
  const standard = { von: 'ELW 1', an: 'ELW 1' };

  it('ohne Angabe gilt der Standard auf beiden Seiten', () => {
    expect(wirksameMetadaten({}, standard)).toMatchObject({ von: 'ELW 1', an: 'ELW 1' });
  });

  it('Ausdrückliches schlägt den Standard je Seite', () => {
    expect(wirksameMetadaten({ von: 'Florian 1' }, standard)).toMatchObject({
      von: 'Florian 1',
      an: 'ELW 1',
    });
    expect(wirksameMetadaten({ an: 'EA-Süd' }, standard)).toMatchObject({
      von: 'ELW 1',
      an: 'EA-Süd',
    });
  });

  it('lässt die übrigen Felder stehen und ohne Standard leer', () => {
    expect(wirksameMetadaten({ meldeweg: 'funk' }, null)).toEqual({
      meldeweg: 'funk',
      von: undefined,
      an: undefined,
    });
  });

  it('ausStandard kennzeichnet nur die Seite ohne eigenen Wert', () => {
    expect(ausStandard('von', { an: 'EA-Süd' }, standard)).toBe(true);
    expect(ausStandard('an', { an: 'EA-Süd' }, standard)).toBe(false);
    expect(ausStandard('von', {}, null)).toBe(false);
  });
});

describe('fehlendeSeite', () => {
  it('nennt zuerst Von, dann An', () => {
    expect(fehlendeSeite({})).toBe('von');
    expect(fehlendeSeite({ von: 'ELW 1', an: ' ' })).toBe('an');
    expect(fehlendeSeite({ von: 'ELW 1', an: 'ELW 1' })).toBeNull();
  });
});
