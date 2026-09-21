import { describe, expect, it } from 'vitest';
import type { EtbEintragAnzeige } from '../api/types';
import type { AbgelehnterEintrag, AusstehenderEintrag } from '../offline/queue';
import { baueZeilen } from './etbZeile';
import {
  berichtigungsindex,
  bilanzUmfang,
  einfrierSchluessel,
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
    eintraege: [e({ id: 3 }), e({ id: 2 }), e({ id: 1 })],
    ausstehend: [puffer],
    abgelehnt: [],
  });

  it('zeigt ohne Einfrieren alles', () => {
    expect(teileZufluss(zeilen, null)).toEqual({ sichtbar: zeilen, zurueckgehalten: 0 });
  });

  it('hält neue gesendete Einträge zurück, zeigt gepufferte immer', () => {
    const gefroren = new Set(['eintrag-2', 'eintrag-1']);
    const { sichtbar, zurueckgehalten } = teileZufluss(zeilen, gefroren);
    expect(zurueckgehalten).toBe(1);
    expect(sichtbar.map((z) => z.schluessel)).toEqual(['ausstehend-1', 'eintrag-2', 'eintrag-1']);
  });

  it('lässt entfallene Einträge sofort fallen', () => {
    const gefroren = new Set(['eintrag-9', 'eintrag-3']);
    const { sichtbar } = teileZufluss(zeilen, gefroren);
    expect(sichtbar.map((z) => z.schluessel)).not.toContain('eintrag-9');
  });

  it('friert nur gesendete Einträge ein', () => {
    expect([...einfrierSchluessel(zeilen)]).toEqual(['eintrag-3', 'eintrag-2', 'eintrag-1']);
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
