import { describe, expect, it } from 'vitest';
import {
  SCHLUESSEL_ETB_STANDARD_RUFNAME,
  anWieVon,
  auchInMeldungseingang,
  ausStandard,
  fehlendeSeite,
  leseStandardRufname,
  meldungseingangVorgabe,
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

  it('Meldung: An ist die eigene Stelle, Von bleibt leer (Pflicht)', () => {
    expect(wirksameMetadaten({}, standard, 'meldung')).toMatchObject({
      von: undefined,
      an: 'ELW 1',
    });
  });

  it('Anordnung: Von ist die eigene Stelle, An bleibt leer (Pflicht)', () => {
    expect(wirksameMetadaten({}, standard, 'anordnung')).toMatchObject({
      von: 'ELW 1',
      an: undefined,
    });
  });

  it('Entscheidung und Lage: beide Seiten die eigene Stelle', () => {
    for (const typ of ['entscheidung', 'lage'] as const) {
      expect(wirksameMetadaten({}, standard, typ)).toMatchObject({ von: 'ELW 1', an: 'ELW 1' });
    }
  });

  it('nimmt je Seite den passenden Teil des Standards', () => {
    const getrennt = { von: 'ELW 1', an: 'S2' };
    expect(wirksameMetadaten({}, getrennt, 'meldung')).toMatchObject({ an: 'S2' });
    expect(wirksameMetadaten({}, getrennt, 'anordnung')).toMatchObject({ von: 'ELW 1' });
  });

  it('Ausdrückliches schlägt die Vorgabe je Seite', () => {
    expect(wirksameMetadaten({ von: 'Florian 3' }, standard, 'meldung')).toMatchObject({
      von: 'Florian 3',
      an: 'ELW 1',
    });
    expect(wirksameMetadaten({ an: 'EA-Süd' }, standard, 'anordnung')).toMatchObject({
      von: 'ELW 1',
      an: 'EA-Süd',
    });
  });

  it('Typwechsel behält Ausdrückliches und wendet die Vorgabe neu an', () => {
    const metadaten = { von: 'Florian 3' };
    expect(wirksameMetadaten(metadaten, standard, 'meldung')).toMatchObject({
      von: 'Florian 3',
      an: 'ELW 1',
    });
    expect(wirksameMetadaten(metadaten, standard, 'entscheidung')).toMatchObject({
      von: 'Florian 3',
      an: 'ELW 1',
    });
    expect(wirksameMetadaten({ an: 'EA-Süd' }, standard, 'meldung')).toMatchObject({
      von: undefined,
      an: 'EA-Süd',
    });
  });

  it('eine Berichtigung ohne Von/An des Originals bekommt die eigene Stelle', () => {
    expect(wirksameMetadaten({}, standard, 'berichtigung')).toMatchObject({
      von: 'ELW 1',
      an: 'ELW 1',
    });
    expect(wirksameMetadaten({ von: 'Florian 3' }, standard, 'berichtigung')).toMatchObject({
      von: 'Florian 3',
    });
  });

  it('Systemeinträge bekommen keine Vorgabe', () => {
    expect(wirksameMetadaten({}, standard, 'system')).toMatchObject({
      von: undefined,
      an: undefined,
    });
  });

  it('lässt die übrigen Felder stehen und ohne Standard leer', () => {
    expect(wirksameMetadaten({ meldeweg: 'funk' }, null, 'lage')).toEqual({
      meldeweg: 'funk',
      von: undefined,
      an: undefined,
    });
  });

  it('ausStandard kennzeichnet nur die Seite, die die Vorgabe des Typs trägt', () => {
    expect(ausStandard('von', { an: 'EA-Süd' }, standard, 'lage')).toBe(true);
    expect(ausStandard('an', { an: 'EA-Süd' }, standard, 'lage')).toBe(false);
    expect(ausStandard('von', {}, standard, 'meldung')).toBe(false);
    expect(ausStandard('an', {}, standard, 'meldung')).toBe(true);
    expect(ausStandard('an', {}, standard, 'anordnung')).toBe(false);
    expect(ausStandard('von', {}, null, 'lage')).toBe(false);
  });
});

describe('fehlendeSeite', () => {
  it('nennt zuerst Von, dann An', () => {
    expect(fehlendeSeite({})).toBe('von');
    expect(fehlendeSeite({ von: 'ELW 1', an: ' ' })).toBe('an');
    expect(fehlendeSeite({ von: 'ELW 1', an: 'ELW 1' })).toBeNull();
  });
});

describe('„Auch in den Meldungseingang“ (kwc2yszv, D4)', () => {
  const standard = { von: 'ELW 1', an: 'ELW 1' };

  it('Vorgabe an, wenn eine Seite nicht die eigene Stelle ist', () => {
    expect(meldungseingangVorgabe({ von: 'Florian 3', an: 'ELW 1' }, standard)).toBe(true);
    expect(meldungseingangVorgabe({ von: undefined, an: 'ELW 1' }, standard)).toBe(true);
  });

  it('Vorgabe aus, wenn Von und An die eigene Stelle sind', () => {
    expect(meldungseingangVorgabe({ von: 'ELW 1', an: 'ELW 1' }, standard)).toBe(false);
    expect(meldungseingangVorgabe({ von: 'ELW 1', an: 'S2' }, { von: 'ELW 1', an: 'S2' })).toBe(
      false,
    );
  });

  it('ohne Standard gibt es keine eigene Stelle: Vorgabe an', () => {
    expect(meldungseingangVorgabe({ von: 'ELW 1', an: 'ELW 1' }, null)).toBe(true);
  });

  it('die Handwahl schlägt die Vorgabe, fehlt sie, gilt die Vorgabe', () => {
    const eigen = { von: 'ELW 1', an: 'ELW 1' };
    const fremd = { von: 'Florian 3', an: 'ELW 1' };
    expect(auchInMeldungseingang(undefined, eigen, standard)).toBe(false);
    expect(auchInMeldungseingang(undefined, fremd, standard)).toBe(true);
    // `nur_protokollieren: true` heißt „aus“, `false` heißt „an“ — beide von Hand.
    expect(auchInMeldungseingang(true, fremd, standard)).toBe(false);
    expect(auchInMeldungseingang(false, eigen, standard)).toBe(true);
  });
});
