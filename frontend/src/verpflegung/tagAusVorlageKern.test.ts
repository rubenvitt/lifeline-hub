import { describe, expect, it } from 'vitest';
import { mitProzessZone } from '../test/prozessZone';
import { zeitfenster } from '../test/verpflegungDaten';
import { mahlzeit, verpflegungsplan } from '../test/verpflegungVorlageDaten';
import {
  buildTagAusVorlageEingabe,
  buildTagFenster,
  isAnlegbar,
  isGleicheBezeichnung,
  quittungText,
  tagText,
} from './tagAusVorlageKern';

const BERLIN = 'Europe/Berlin';

/** Browser UTC, Anzeigezone Berlin: unter der Suiten-Zone Berlin wäre der Test blind. */
describe('Tag aus der Vorlage — Zonenrechnung (LLH-1058)', () => {
  mitProzessZone('UTC');

  it('11.10.: drei Mahlzeiten liegen in Berliner Sommerzeit, die Nacht endet am Folgetag', () => {
    const f = buildTagFenster(verpflegungsplan(), '2026-10-11', BERLIN, []);
    expect(f.map((x) => [x.vorlage.bezeichnung, x.von_at, x.bis_at, x.folgetag])).toEqual([
      ['Frühstück', '2026-10-11 04:30:00', '2026-10-11 06:00:00', false],
      ['Mittag', '2026-10-11 10:00:00', '2026-10-11 11:30:00', false],
      ['Abendessen', '2026-10-11 16:00:00', '2026-10-11 17:30:00', false],
      ['Nachtverpflegung', '2026-10-11 21:00:00', '2026-10-11 23:00:00', true],
    ]);
    expect(f.every(isAnlegbar)).toBe(true);
  });

  it('25.10.: vor der Umstellung Sommer-, danach Winterzeit; die Nacht liegt in Winterzeit', () => {
    const plan = [
      mahlzeit({ id: 9, bezeichnung: 'Früh', beginn: '01:30', ende: '06:30' }),
      ...verpflegungsplan(),
    ];
    const f = buildTagFenster(plan, '2026-10-25', BERLIN, []);
    expect(f.map((x) => [x.vorlage.bezeichnung, x.von_at, x.bis_at])).toEqual([
      ['Früh', '2026-10-24 23:30:00', '2026-10-25 05:30:00'],
      ['Frühstück', '2026-10-25 05:30:00', '2026-10-25 07:00:00'],
      ['Mittag', '2026-10-25 11:00:00', '2026-10-25 12:30:00'],
      ['Abendessen', '2026-10-25 17:00:00', '2026-10-25 18:30:00'],
      ['Nachtverpflegung', '2026-10-25 22:00:00', '2026-10-26 00:00:00'],
    ]);
  });

  it('29.03.: eine Mahlzeit ganz in der Lücke der Umstellung ist nicht anlegbar', () => {
    const plan = [
      mahlzeit({ id: 8, bezeichnung: 'Lücke', beginn: '02:00', ende: '03:00' }),
      mahlzeit({ id: 9, bezeichnung: 'Halb', beginn: '02:30', ende: '04:00' }),
      mahlzeit({ id: 1 }),
    ];
    const f = buildTagFenster(plan, '2026-03-29', BERLIN, []);
    const lücke = f.find((x) => x.vorlage.id === 8)!;
    expect(lücke.zeitumstellung).toBe(true);
    expect(isAnlegbar(lücke)).toBe(false);
    // 02:30 rückt auf 03:30 Sommerzeit, das Ende 04:00 liegt danach: anlegbar.
    const halb = f.find((x) => x.vorlage.id === 9)!;
    expect([halb.von_at, halb.bis_at, halb.zeitumstellung]).toEqual([
      '2026-03-29 01:30:00',
      '2026-03-29 02:00:00',
      false,
    ]);
    expect(f.find((x) => x.vorlage.id === 1)!.von_at).toBe('2026-03-29 04:30:00');
  });

  it('die Anfrage trägt die Tagesgrenzen der Anzeigezone und nur die gewählten Fenster', () => {
    const f = buildTagFenster(verpflegungsplan(), '2026-10-25', BERLIN, []);
    const body = buildTagAusVorlageEingabe('2026-10-25', BERLIN, [
      { fenster: f[1], bedarf_kraefte: 180, bedarf_betreute: 70 },
      { fenster: f[0], bedarf_kraefte: 186, bedarf_betreute: 0 },
    ]);
    expect(body).toEqual({
      tag_von_at: '2026-10-24 22:00:00',
      tag_bis_at: '2026-10-25 23:00:00',
      // In der Folge des Plans, gleich in welcher Folge gewählt wurde; die Art geht mit.
      zeitfenster: [
        {
          bezeichnung: 'Frühstück',
          von_at: '2026-10-25 05:30:00',
          bis_at: '2026-10-25 07:00:00',
          bedarf_kraefte: 186,
          bedarf_betreute: 0,
        },
        {
          bezeichnung: 'Mittag',
          von_at: '2026-10-25 11:00:00',
          bis_at: '2026-10-25 12:30:00',
          bedarf_kraefte: 180,
          bedarf_betreute: 70,
          verpflegungsart: 'warm',
        },
      ],
    });
  });
});

describe('Tag aus der Vorlage — Bestand am Tag', () => {
  mitProzessZone('UTC');

  it('ein gleichnamiges Zeitfenster, das an diesem Tag beginnt, macht die Mahlzeit „vorhanden“', () => {
    const bestand = [
      // „mittag“ am 11.10. 12:15 Berlin: gleich, auch in anderer Schreibung.
      zeitfenster({
        id: 1,
        bezeichnung: ' mittag ',
        von_at: '2026-10-11 10:15:00',
        bis_at: '2026-10-11 11:00:00',
      }),
      // „Abendessen“ am Vortag: zählt nicht.
      zeitfenster({
        id: 2,
        bezeichnung: 'Abendessen',
        von_at: '2026-10-10 16:00:00',
        bis_at: '2026-10-10 17:30:00',
      }),
      // „Frühstück“ beginnt 00:30 Berlin am 12.10. (22:30 UTC am 11.10.): nicht dieser Tag.
      zeitfenster({
        id: 3,
        bezeichnung: 'Frühstück',
        von_at: '2026-10-11 22:30:00',
        bis_at: '2026-10-11 23:00:00',
      }),
      // Tagesbeginn 00:00 Berlin gehört zum Tag.
      zeitfenster({
        id: 4,
        bezeichnung: 'Nachtverpflegung',
        von_at: '2026-10-10 22:00:00',
        bis_at: '2026-10-10 23:00:00',
      }),
    ];
    const f = buildTagFenster(verpflegungsplan(), '2026-10-11', BERLIN, bestand);
    expect(f.map((x) => [x.vorlage.bezeichnung, x.vorhanden])).toEqual([
      ['Frühstück', false],
      ['Mittag', true],
      ['Abendessen', false],
      ['Nachtverpflegung', true],
    ]);
    expect(isAnlegbar(f[1])).toBe(false);
  });

  it('Bezeichnungen gleichen getrimmt und ohne Groß- und Kleinschreibung, auch mit Umlaut', () => {
    expect(isGleicheBezeichnung('FRÜHSTÜCK', ' frühstück')).toBe(true);
    expect(isGleicheBezeichnung('Mittag', 'Mittag 2')).toBe(false);
  });

  it('nur aktive Mahlzeiten werden zu Fenstern', () => {
    const plan = [mahlzeit({ id: 1 }), mahlzeit({ id: 2, bezeichnung: 'Alt', aktiv: false })];
    expect(buildTagFenster(plan, '2026-10-11', BERLIN, []).map((x) => x.vorlage.id)).toEqual([1]);
  });
});

describe('Quittung', () => {
  it('nennt den Tag, die Zahl und jedes übersprungene Fenster', () => {
    const k = { zeitzone: 'Europe/Berlin' };
    expect(tagText('2026-10-11', k)).toBe('11okt26');
    expect(tagText('2026-10-11', { ...k, zeitdarstellung: 'datum_uhrzeit' })).toBe('11.10.26');
    expect(
      quittungText(
        { angelegt: [zeitfenster(), zeitfenster()], uebersprungen: [] },
        '2026-10-11',
        k,
      ),
    ).toBe('2 Zeitfenster für den 11okt26 angelegt');
    expect(
      quittungText({ angelegt: [zeitfenster()], uebersprungen: ['Mittag'] }, '2026-10-11', k),
    ).toBe('1 Zeitfenster für den 11okt26 angelegt · am Tag schon vorhanden: ‚Mittag‘');
    expect(
      quittungText({ angelegt: [], uebersprungen: ['Frühstück', 'Mittag'] }, '2026-10-11', k),
    ).toBe('Kein Zeitfenster angelegt · am Tag schon vorhanden: ‚Frühstück‘, ‚Mittag‘');
  });
});
