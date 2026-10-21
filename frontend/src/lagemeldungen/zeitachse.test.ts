import { describe, expect, it } from 'vitest';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import {
  LEERER_FILTER,
  type Herkunftsfilter,
  filterAktiv,
  filtereLagemeldungen,
  gruppiereNachTag,
  imZeitfenster,
  tagesEtikett,
  tagesSchluessel,
  uebergabeZeit,
} from './zeitachse';

dayjs.extend(utc);

describe('zeitachse', () => {
  it('bildet den Tagesschlüssel in der Anzeigezone, nicht in UTC', () => {
    // 23:30 UTC ist in Berlin (Sommer, +2) schon der 13. — ein `dayjs(s)`-Leser käme auf
    // den 12. und hängte den Eintrag unter den falschen Tageskopf.
    expect(tagesSchluessel('2026-06-12 23:30:00', { zeitzone: 'Europe/Berlin' })).toBe(
      '2026-06-13',
    );
    expect(tagesSchluessel('2026-06-12 23:30:00', { zeitzone: 'UTC' })).toBe('2026-06-12');
  });

  it('etikettiert Heute, Gestern und sonst das Datum', () => {
    const jetzt = dayjs('2026-06-13 10:00:00');
    expect(tagesEtikett('2026-06-13', undefined, jetzt)).toBe('Heute');
    expect(tagesEtikett('2026-06-12', undefined, jetzt)).toBe('Gestern');
    expect(tagesEtikett('2026-06-01', undefined, jetzt)).toBe('01.06.2026');
  });

  it('bestimmt „Heute" in der Anzeigezone, nicht in der Browserzone (Review LFH-348)', () => {
    // 23:00 UTC am 12.: in Auckland (+12) ist es der 13. — der Schlüssel aus
    // `tagesSchluessel` sagt 13., und das Etikett muss ihn als „Heute" erkennen.
    const jetzt = dayjs.utc('2026-06-12 23:00:00');
    const auckland = { zeitzone: 'Pacific/Auckland' };
    expect(tagesSchluessel('2026-06-12 23:00:00', auckland)).toBe('2026-06-13');
    expect(tagesEtikett('2026-06-13', auckland, jetzt)).toBe('Heute');
    expect(tagesEtikett('2026-06-12', auckland, jetzt)).toBe('Gestern');
    // Ohne Zone bleibt es die Tagesgrenze des übergebenen `jetzt` (im Betrieb: `dayjs()`, lokal).
    const lokal = jetzt.local();
    expect(tagesEtikett(lokal.format('YYYY-MM-DD'), undefined, lokal)).toBe('Heute');
  });

  it('Zeitfenster: Grenzen einschließend, in der Anzeigezone', () => {
    const jetzt = dayjs.utc('2026-06-13 10:00:00').local();
    expect(imZeitfenster('2026-06-13 09:01:00', 'stunde', jetzt)).toBe(true);
    expect(imZeitfenster('2026-06-13 08:59:00', 'stunde', jetzt)).toBe(false);
    expect(imZeitfenster('2026-06-13 06:01:00', 'vierStunden', jetzt)).toBe(true);
    expect(imZeitfenster('2026-06-13 05:59:00', 'vierStunden', jetzt)).toBe(false);
    // „Heute" kippt an der Tagesgrenze der ZONE: 22:30 UTC am 12. ist in Berlin der 13.
    const berlin = { zeitzone: 'Europe/Berlin' };
    const jetztBerlin = dayjs.utc('2026-06-13 10:00:00').tz('Europe/Berlin');
    expect(imZeitfenster('2026-06-12 22:30:00', 'heute', jetztBerlin, berlin)).toBe(true);
    expect(imZeitfenster('2026-06-12 21:30:00', 'heute', jetztBerlin, berlin)).toBe(false);
  });

  const eintrag = (ereigniszeit: string, text: string, lat: number | null = null) => ({
    text,
    ereigniszeit,
    lat,
    lon: lat,
    meldung_lfd_nr: 5,
    meldung_absender: 'Florian Nord 1',
  });

  it('gruppiert nach Tag der Anzeigezone, jüngster Tag und jüngster Eintrag zuerst', () => {
    const berlin = { zeitzone: 'Europe/Berlin' };
    const jetzt = dayjs.utc('2026-06-13 10:00:00').tz('Europe/Berlin');
    // ABSICHTLICH aufsteigend geliefert (wie vom Server): nur so beweist die Umkehr etwas.
    const gruppen = gruppiereNachTag(
      [
        eintrag('2026-06-12 08:00:00', 'Alt'),
        // 22:30 UTC am 12. ist in Berlin der 13. — gehört unter „Heute", nicht „Gestern".
        eintrag('2026-06-12 22:30:00', 'Nachts'),
        eintrag('2026-06-13 07:00:00', 'Neu'),
      ],
      berlin,
      jetzt,
    );
    expect(gruppen.map((g) => g.etikett)).toEqual(['Heute', 'Gestern']);
    expect(gruppen[0].zeilen.map((z) => z.text)).toEqual(['Neu', 'Nachts']);
    expect(gruppen[1].zeilen.map((z) => z.text)).toEqual(['Alt']);
    expect(gruppiereNachTag([])).toEqual([]);
  });

  it('filtert nach Ort, Zeitfenster und Freitext — jede Achse für sich und zusammen', () => {
    const jetzt = dayjs.utc('2026-06-13 10:00:00').local();
    const menge = [
      eintrag('2026-06-13 09:30:00', 'Brücke gesperrt', 50.1),
      eintrag('2026-06-13 07:00:00', 'Pegel steigt'),
      eintrag('2026-06-12 07:00:00', 'Deich hält', 50.2),
    ];
    const texte = (f: Partial<typeof LEERER_FILTER>) =>
      filtereLagemeldungen(menge, { ...LEERER_FILTER, ...f }, undefined, jetzt).map((l) => l.text);
    expect(texte({})).toEqual(['Brücke gesperrt', 'Pegel steigt', 'Deich hält']);
    expect(texte({ ort: 'mit' })).toEqual(['Brücke gesperrt', 'Deich hält']);
    expect(texte({ ort: 'ohne' })).toEqual(['Pegel steigt']);
    expect(texte({ fenster: 'stunde' })).toEqual(['Brücke gesperrt']);
    expect(texte({ fenster: 'vierStunden', ort: 'ohne' })).toEqual(['Pegel steigt']);
    // Freitext trifft Text, Absender und Nummer, ohne Groß-/Kleinschreibung.
    expect(texte({ suche: '  DEICH ' })).toEqual(['Deich hält']);
    expect(texte({ suche: 'florian' })).toHaveLength(3);
    expect(texte({ suche: 'nichts' })).toEqual([]);
  });

  it('filtert nach Herkunft: Gerät, übernommen; ein alter Lage-Stand ohne Art nur unter „Alle“', () => {
    const menge = [
      {
        ...eintrag('2026-06-13 09:30:00', 'Vom Tablet'),
        meldungsart: 'lagemeldung',
        is_von_geraet: true,
      },
      {
        ...eintrag('2026-06-13 09:00:00', 'Erfasst'),
        meldungsart: 'lagemeldung',
        is_von_geraet: false,
      },
      {
        ...eintrag('2026-06-13 08:00:00', 'Rückmeldung'),
        meldungsart: 'rueckmeldung',
        is_von_geraet: false,
      },
      eintrag('2026-06-13 07:00:00', 'Alter Stand'),
    ];
    const texte = (herkunft: Herkunftsfilter) =>
      filtereLagemeldungen(menge, { ...LEERER_FILTER, herkunft }).map((l) => l.text);
    expect(texte('alle')).toHaveLength(4);
    expect(texte('geraet')).toEqual(['Vom Tablet']);
    expect(texte('uebernommen')).toEqual(['Rückmeldung']);
  });

  /**
   * LLH-1039: Die Zeitachse liest die Ereigniszeit der Quellmeldung, nicht die Übergabe. Eine um
   * 13:14 eingegangene, um 15:05 übergebene Meldung steht unter 13:14 und unter der um 14:41.
   */
  const uebergeben = (ereigniszeit: string, erstellt_at: string, text: string) => ({
    ...eintrag(ereigniszeit, text),
    erstellt_at,
  });

  it('ordnet nach Ereigniszeit, nicht nach Übergabe', () => {
    const berlin = { zeitzone: 'Europe/Berlin' };
    const jetzt = dayjs.utc('2026-06-12 14:00:00').tz('Europe/Berlin');
    // Server-Wire in UTC: 11:14 / 12:41 UTC = 13:14 / 14:41 in Berlin; zuletzt übergeben die frühe.
    const gruppen = gruppiereNachTag(
      [
        uebergeben('2026-06-12 11:14:00', '2026-06-12 13:05:00', 'Brücke gesperrt'),
        uebergeben('2026-06-12 12:41:00', '2026-06-12 12:50:00', 'Pegel steigt'),
      ],
      berlin,
      jetzt,
    );
    expect(gruppen).toHaveLength(1);
    expect(gruppen[0].zeilen.map((z) => z.text)).toEqual(['Pegel steigt', 'Brücke gesperrt']);
  });

  it('bildet den Tag aus der Ereigniszeit, auch wenn erst am nächsten Tag übergeben', () => {
    const berlin = { zeitzone: 'Europe/Berlin' };
    const jetzt = dayjs.utc('2026-06-13 10:00:00').tz('Europe/Berlin');
    const gruppen = gruppiereNachTag(
      [uebergeben('2026-06-12 20:00:00', '2026-06-13 06:00:00', 'Nachgereicht')],
      berlin,
      jetzt,
    );
    expect(gruppen.map((g) => g.etikett)).toEqual(['Gestern']);
  });

  it('Zeitfenster „Letzte Stunde“ filtert nach Ereigniszeit', () => {
    const jetzt = dayjs.utc('2026-06-12 13:10:00').local();
    const menge = [
      // Vor zwei Stunden geschehen, eben erst übergeben: nicht in der letzten Stunde.
      uebergeben('2026-06-12 11:14:00', '2026-06-12 13:05:00', 'Nachgereicht'),
      // Vor 30 Minuten geschehen, schon vor 25 Minuten übergeben: drin.
      uebergeben('2026-06-12 12:40:00', '2026-06-12 12:45:00', 'Frisch'),
    ];
    const texte = filtereLagemeldungen(
      menge,
      { ...LEERER_FILTER, fenster: 'stunde' },
      undefined,
      jetzt,
    ).map((l) => l.text);
    expect(texte).toEqual(['Frisch']);
  });

  it('nennt die Übergabe als Uhrzeit, an einem anderen Tag mit Datum', () => {
    const berlin = { zeitzone: 'Europe/Berlin' };
    // Am selben Tag (Berlin) genügt die Uhrzeit — der Tag steht im Kopf.
    expect(uebergabeZeit('2026-06-12 11:14:00', '2026-06-12 13:05:00', berlin)).toBe('15:05');
    // 22:30 UTC am 12. ist in Berlin schon der 13.: anderer Tag als die Ereigniszeit.
    expect(uebergabeZeit('2026-06-12 11:14:00', '2026-06-12 22:30:00', berlin)).toBe(
      '13.06. 00:30',
    );
  });

  it('unterscheidet ungefiltert von gefiltert (Leerzustand „weggefiltert")', () => {
    expect(filterAktiv(LEERER_FILTER)).toBe(false);
    expect(filterAktiv({ ...LEERER_FILTER, suche: '   ' })).toBe(false);
    expect(filterAktiv({ ...LEERER_FILTER, ort: 'mit' })).toBe(true);
    expect(filterAktiv({ ...LEERER_FILTER, fenster: 'heute' })).toBe(true);
    expect(filterAktiv({ ...LEERER_FILTER, herkunft: 'geraet' })).toBe(true);
  });
});
