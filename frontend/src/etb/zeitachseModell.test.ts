import { describe, expect, it } from 'vitest';
import type { EtbEintragAnzeige } from '../api/types';
import type { AbgelehnterEintrag, AusstehenderEintrag } from '../offline/queue';
import { baueZeilen } from './etbZeile';
import {
  berichtigungsindex,
  bilanzUmfang,
  einfrieren,
  filterMitTyp,
  filterZusammenfuehren,
  gruppiereNachStunde,
  kopfMeta,
  letzteBerichtigungen,
  pufferZustand,
  stundenEtikett,
  teileZufluss,
  typBilanz,
  typSegmente,
  hatVerknuepfung,
  verweisStil,
} from './zeitachseModell';

function e(over: Partial<EtbEintragAnzeige>): EtbEintragAnzeige {
  return {
    id: 1,
    lfd_nr: 1,
    typ: 'meldung',
    inhalt: 'x',
    erfasser_id: 1,
    erfasser_name: 'M',
    ereigniszeit: '2026-05-23 10:00:00',
    received_at: '2026-05-23 10:00:00',
    folgeauftraege: [],
    ...over,
  };
}

const puffer: AusstehenderEintrag = {
  id: 1,
  benutzer_id: 1,
  einsatz_id: 1,
  eintrag: { typ: 'meldung', inhalt: 'p' },
  erstellt_at: '2026-05-23 10:05:00',
};
const abgelehnt: AbgelehnterEintrag = { ...puffer, grund: 'g', abgelehnt_at: '2026-05-23 10:06' };

describe('gruppiereNachStunde', () => {
  // Identität als Zone: die Stunde steckt in den ersten 13 Zeichen des Wire-Strings.
  const stunde = (utc: string) => utc.slice(0, 13);

  it('trennt gleiche Stunden verschiedener Tage', () => {
    const zeilen = baueZeilen({
      eintraege: [
        e({ id: 2, ereigniszeit: '2026-05-24 14:10:00' }),
        e({ id: 1, ereigniszeit: '2026-05-23 14:10:00' }),
      ],
      ausstehend: [],
      abgelehnt: [],
    });
    const gruppen = gruppiereNachStunde(zeilen, stunde);
    expect(gruppen.map((g) => g.etikett)).toEqual(['24.05. · 14 Uhr', '23.05. · 14 Uhr']);
  });

  it('springt nicht in eine frühere Gruppe zurück — die Serverordnung gewinnt', () => {
    const zeilen = baueZeilen({
      eintraege: [
        e({ id: 3, ereigniszeit: '2026-05-23 11:00:00' }),
        e({ id: 2, ereigniszeit: '2026-05-23 10:00:00' }), // Nachtrag mit alter Zeit
        e({ id: 1, ereigniszeit: '2026-05-23 11:30:00' }),
      ],
      ausstehend: [],
      abgelehnt: [],
    });
    expect(gruppiereNachStunde(zeilen, stunde).map((g) => g.zeilen.length)).toEqual([1, 1, 1]);
  });

  it('ordnet gepufferte Zeilen nach ihrer lokalen Erfassungszeit ein', () => {
    const zeilen = baueZeilen({ eintraege: [], ausstehend: [puffer], abgelehnt: [] });
    expect(gruppiereNachStunde(zeilen, stunde)[0].schluessel).toBe('2026-05-23 10');
  });

  it('beschriftet die Stunde mit Tag', () => {
    expect(stundenEtikett('2026-09-21 07')).toBe('21.09. · 07 Uhr');
  });
});

describe('berichtigungsindex', () => {
  it('verknüpft beide Richtungen', () => {
    const grund = e({ id: 1, lfd_nr: 5 });
    const b = e({ id: 2, lfd_nr: 9, typ: 'berichtigung', berichtigt_eintrag_id: 1 });
    const index = berichtigungsindex([b, grund]);
    expect(index.grundeintrag(b)).toEqual({ id: 1, lfd_nr: 5 });
    expect(index.berichtigtDurch(grund)).toEqual([{ id: 2, lfd_nr: 9 }]);
    expect(index.grundeintrag(grund)).toBeNull();
  });

  it('kennt die Nummer eines nicht geladenen Grundeintrags nicht — und erfindet keine', () => {
    const b = e({ id: 2, typ: 'berichtigung', berichtigt_eintrag_id: 77 });
    expect(berichtigungsindex([b]).grundeintrag(b)).toEqual({ id: 77, lfd_nr: null });
  });

  it('liefert die jüngsten Berichtigungen in Serverordnung', () => {
    const liste = [
      e({ id: 4, typ: 'berichtigung' }),
      e({ id: 3 }),
      e({ id: 2, typ: 'berichtigung' }),
      e({ id: 1, typ: 'berichtigung' }),
    ];
    expect(letzteBerichtigungen(liste, 2).map((x) => x.id)).toEqual([4, 2]);
  });
});

describe('Bilanz und Kopfzahl — ehrlich über die geladene Menge', () => {
  it('zählt je Typ und zeigt System nur, wenn es vorkommt', () => {
    const ohne = typBilanz([e({ typ: 'meldung' }), e({ typ: 'meldung' }), e({ typ: 'lage' })]);
    expect(ohne.map((z) => [z.typ, z.anzahl])).toEqual([
      ['meldung', 2],
      ['anordnung', 0],
      ['entscheidung', 0],
      ['lage', 1],
      ['berichtigung', 0],
    ]);
    const mit = typBilanz([e({ typ: 'system' })]);
    expect(mit[mit.length - 1]).toEqual({ typ: 'system', anzahl: 1 });
  });

  it.each([
    [
      { geladen: 100, weitereSeiten: true, filterAktiv: false },
      'in 100 geladenen Einträgen — ältere sind nicht mitgezählt',
    ],
    [
      { geladen: 12, weitereSeiten: false, filterAktiv: true },
      'in 12 geladenen Einträgen, die zum Filter passen',
    ],
    [{ geladen: 37, weitereSeiten: false, filterAktiv: false }, 'in allen 37 Einträgen'],
  ])('nennt den Umfang der Zählung %#', (args, text) => {
    expect(bilanzUmfang(args)).toBe(text);
  });

  it('sagt „alle" nur ohne Filter und ohne weitere Seite', () => {
    for (const args of [
      { geladen: 5, weitereSeiten: true, filterAktiv: false },
      { geladen: 5, weitereSeiten: false, filterAktiv: true },
    ]) {
      expect(bilanzUmfang(args)).not.toContain('allen');
    }
  });

  it.each([
    [
      { geladen: 100, weitereSeiten: true, filterAktiv: false },
      '100 Einträge geladen · ältere vorhanden',
    ],
    [{ geladen: 3, weitereSeiten: false, filterAktiv: true }, '3 Treffer'],
    [{ geladen: 1, weitereSeiten: false, filterAktiv: false }, '1 Eintrag'],
    [{ geladen: 37, weitereSeiten: false, filterAktiv: false }, '37 Einträge'],
  ])('Kopf-Meta %#', (args, text) => {
    expect(kopfMeta(args)).toBe(text);
  });
});

describe('pufferZustand', () => {
  it('unterscheidet übertragen, ausstehend und abgelehnt — abgelehnt gewinnt', () => {
    expect(pufferZustand([], [])).toEqual({ art: 'uebertragen' });
    expect(pufferZustand([puffer, puffer], [])).toEqual({ art: 'ausstehend', ausstehend: 2 });
    expect(pufferZustand([puffer], [abgelehnt])).toEqual({
      art: 'abgelehnt',
      abgelehnt: 1,
      ausstehend: 1,
    });
  });
});

describe('Typfilter', () => {
  it('führt die Segmente des Entwurfs, System nur als aktiver URL-Wert', () => {
    expect(typSegmente(undefined)).toEqual([
      'alle',
      'meldung',
      'anordnung',
      'entscheidung',
      'lage',
      'berichtigung',
    ]);
    const mitSystem = typSegmente('system');
    expect(mitSystem[mitSystem.length - 1]).toBe('system');
  });

  it('„alle" nimmt den Typ heraus, ein Segment setzt ihn, der Rest bleibt', () => {
    expect(filterMitTyp({ q: 'a', typ: 'lage' }, 'alle')).toEqual({ q: 'a' });
    expect(filterMitTyp({ q: 'a' }, 'anordnung')).toEqual({ q: 'a', typ: 'anordnung' });
  });

  it('führt eine Teiländerung gegen den AKTUELLEN Filter zusammen und räumt Leeres', () => {
    // Der Nachläufer der Suchfrist bringt q/von/bis — der Typ aus der Segmentleiste bleibt.
    expect(
      filterZusammenfuehren({ typ: 'lage' }, { q: 'pegel', von: undefined, bis: undefined }),
    ).toEqual({ typ: 'lage', q: 'pegel' });
    const geleert = filterZusammenfuehren({ q: 'alt', typ: 'lage' }, { q: undefined });
    expect(geleert).toEqual({ typ: 'lage' });
    expect(Object.keys(geleert)).not.toContain('q');
    expect(filterZusammenfuehren({ q: 'x' }, { q: '' })).toEqual({});
  });
});

describe('teileZufluss', () => {
  const zeilen = baueZeilen({
    eintraege: [e({ id: 3, lfd_nr: 3 }), e({ id: 2, lfd_nr: 2 }), e({ id: 1, lfd_nr: 1 })],
    ausstehend: [puffer],
    abgelehnt: [],
  });
  /** Eingefroren, als nur Nr. 1 und Nr. 2 zu sehen waren. */
  const stand = einfrieren(
    baueZeilen({
      eintraege: [e({ id: 2, lfd_nr: 2 }), e({ id: 1, lfd_nr: 1 })],
      ausstehend: [],
      abgelehnt: [],
    }),
  )!;

  it('zeigt ohne Einfrieren alles', () => {
    expect(teileZufluss(zeilen, null)).toEqual({ sichtbar: zeilen, zurueckgehalten: 0 });
  });

  it('hält einen fremden NEUEN Eintrag über der Wassermarke zurück, zeigt gepufferte immer', () => {
    expect(stand.wassermarke).toBe(2);
    const { sichtbar, zurueckgehalten } = teileZufluss(zeilen, stand, 99);
    expect(zurueckgehalten).toBe(1);
    expect(sichtbar.map((z) => z.schluessel)).toEqual(['ausstehend-1', 'eintrag-2', 'eintrag-1']);
  });

  it('lässt entfallene Einträge sofort fallen', () => {
    const { sichtbar } = teileZufluss(zeilen, einfrieren(zeilen));
    expect(sichtbar.map((z) => z.schluessel)).not.toContain('eintrag-9');
  });

  /*
   * Befund A (Review 22.09.2026): ein Deeplink auf einen nicht geladenen Grundeintrag lädt
   * ÄLTERE Seiten nach, während der Fokus im Verweis liegt. Die Vorgängerin hielt alles
   * zurück, was nicht im Einfrier-Satz stand — auch das Alte, das unter dem Cursor gar
   * nicht springen kann (es kommt UNTEN an). Das Banner meldete es als „neu", und der
   * Sprung fand seine Zeile nicht.
   */
  it('sortiert nachgeladene ÄLTERE Einträge sofort ein, auch eingefroren', () => {
    const mitAelteren = baueZeilen({
      eintraege: [e({ id: 2, lfd_nr: 2 }), e({ id: 1, lfd_nr: 1 }), e({ id: 7, lfd_nr: 0 })],
      ausstehend: [],
      abgelehnt: [],
    });
    const eng = einfrieren(
      baueZeilen({ eintraege: [e({ id: 2, lfd_nr: 2 })], ausstehend: [], abgelehnt: [] }),
    )!;
    const { sichtbar, zurueckgehalten } = teileZufluss(mitAelteren, eng, 99);
    expect(zurueckgehalten).toBe(0);
    expect(sichtbar.map((z) => z.schluessel)).toEqual(['eintrag-2', 'eintrag-1', 'eintrag-7']);
  });

  /*
   * Befund B: der eigene gepufferte Eintrag wird gesendet — die Pufferzeile geht, die
   * Serverzeile kommt mit neuem Schlüssel. Hielte die Achse sie zurück, wäre der eigene
   * Eintrag für diesen Moment nirgends zu sehen.
   */
  it('hält den EIGENEN gerade gesendeten Eintrag nie zurück', () => {
    const nachSenden = baueZeilen({
      eintraege: [e({ id: 3, lfd_nr: 3, erfasser_id: 42 }), e({ id: 2, lfd_nr: 2 })],
      ausstehend: [],
      abgelehnt: [],
    });
    const { sichtbar, zurueckgehalten } = teileZufluss(nachSenden, stand, 42);
    expect(zurueckgehalten).toBe(0);
    expect(sichtbar.map((z) => z.schluessel)).toEqual(['eintrag-3', 'eintrag-2']);
    // Gegenprobe: derselbe Eintrag eines ANDEREN Erfassers bleibt zurück.
    expect(teileZufluss(nachSenden, stand, 7).zurueckgehalten).toBe(1);
  });

  it('friert nur gesendete Einträge ein und merkt sich die höchste Nummer', () => {
    const s = einfrieren(zeilen)!;
    expect([...s.schluessel]).toEqual(['eintrag-3', 'eintrag-2', 'eintrag-1']);
    expect(s.wassermarke).toBe(3);
  });

  it('friert eine Folge ohne gesendeten Eintrag nicht ein', () => {
    expect(
      einfrieren(baueZeilen({ eintraege: [], ausstehend: [puffer], abgelehnt: [] })),
    ).toBeNull();
  });
});

describe('verweisStil', () => {
  it('gibt einem Textverweis den Boden der Dichtestufe — über zwei Stufen verschieden', () => {
    // Böden als Literale (CLAUDE.md, LFH-365): aus dem Token zurückgelesen prüfte die
    // Zusicherung den Token gegen sich selbst.
    expect(verweisStil({ controlHeight: 30 }).minHeight).toBe(30);
    expect(verweisStil({ controlHeight: 72 }).minHeight).toBe(72);
    expect(verweisStil({ controlHeight: 30 }).display).toBe('inline-flex');
  });
});

describe('hatVerknuepfung (LFH-636)', () => {
  it('kennt jeden Rückverweis und die Folgeaufträge als eigenen Grund', () => {
    expect(hatVerknuepfung(e({}))).toBe(false);
    expect(hatVerknuepfung(e({ befehl_id: 1 }))).toBe(true);
    expect(hatVerknuepfung(e({ lagebericht_id: 1 }))).toBe(true);
    expect(hatVerknuepfung(e({ auftrag_id: 1 }))).toBe(true);
    expect(hatVerknuepfung(e({ folgeauftraege: [{ id: 3, lfd_nr: 1 }] }))).toBe(true);
  });
});
