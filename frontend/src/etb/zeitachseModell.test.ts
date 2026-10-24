import { describe, expect, it } from 'vitest';
import type { EtbEintragAnzeige } from '../api/types';
import type { AbgelehnterEintrag, AusstehenderEintrag } from '../offline/queue';
import { funkprotokollFolge } from '../components/useFunkprotokollLauf';
import { DEFAULT_KONVENTIONEN } from '../anzeige/format';
import { baueZeilen } from './etbZeile';
import {
  berichtigungsindex,
  berichtigungTitel,
  buendleSystemfolgen,
  dokumenteJeEintrag,
  einfrieren,
  filterMitTyp,
  filterZusammenfuehren,
  gruppiereNachStunde,
  kopfMeta,
  nachtragText,
  letzteBerichtigungen,
  pufferZustand,
  stundenKopf,
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
    berichtigt_durch: [],
    einheiten: [],
    anhaenge: [],
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

/** Zone UTC, „jetzt“ am 23.05.2026 abends: Köpfe vom 23.05. stehen ohne Tag. */
const UTC = { zeitzone: 'UTC' };
const JETZT_23 = Date.UTC(2026, 4, 23, 20, 0, 0);
const kopf = (utc: string) => stundenKopf(utc, UTC, JETZT_23);

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
    const gruppen = gruppiereNachStunde(zeilen, stunde, kopf);
    expect(gruppen.map((g) => g.etikett)).toEqual(['241400', '1400']);
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
    expect(gruppiereNachStunde(zeilen, stunde, kopf).map((g) => g.zeilen.length)).toEqual([
      1, 1, 1,
    ]);
  });

  it('ordnet gepufferte Zeilen nach ihrer lokalen Erfassungszeit ein', () => {
    const zeilen = baueZeilen({ eintraege: [], ausstehend: [puffer], abgelehnt: [] });
    expect(gruppiereNachStunde(zeilen, stunde, kopf)[0].schluessel).toBe('2026-05-23 10');
  });

  it('beschriftet die Stunde in der Rolle „kurz“: heute ohne, sonst mit Tag (LLH-1061)', () => {
    expect(stundenKopf('2026-05-23 07:42:00', UTC, JETZT_23)).toBe('0700');
    expect(stundenKopf('2026-05-21 07:42:00', UTC, JETZT_23)).toBe('210700');
    expect(
      stundenKopf('2026-05-21 07:42:00', { ...UTC, zeitdarstellung: 'datum_uhrzeit' }, JETZT_23),
    ).toBe('21.05. 07:00');
  });

  it('rechnet den Kopf in der Anzeigezone: 23:30 UTC ist in Berlin schon der nächste Tag', () => {
    expect(stundenKopf('2026-05-23 23:30:00', { zeitzone: 'Europe/Berlin' }, JETZT_23)).toBe(
      '240100',
    );
  });
});

describe('funkprotokollFolge (LLH-1149)', () => {
  const stunde = (utc: string) => utc.slice(0, 13);

  it('kehrt die Serverordnung um: älteste oben, gepufferte ganz unten, abgelehnte zuletzt', () => {
    const zeilen = baueZeilen({
      eintraege: [e({ id: 3, lfd_nr: 3 }), e({ id: 2, lfd_nr: 2 }), e({ id: 1, lfd_nr: 1 })],
      ausstehend: [puffer],
      abgelehnt: [abgelehnt],
    });
    expect(funkprotokollFolge(zeilen).map((z) => z.schluessel)).toEqual([
      'eintrag-1',
      'eintrag-2',
      'eintrag-3',
      'ausstehend-1',
      'abgelehnt-1',
    ]);
  });

  it('lässt die Eingabe unberührt', () => {
    const zeilen = baueZeilen({
      eintraege: [e({ id: 2 }), e({ id: 1 })],
      ausstehend: [],
      abgelehnt: [],
    });
    funkprotokollFolge(zeilen);
    expect(zeilen.map((z) => z.schluessel)).toEqual(['eintrag-2', 'eintrag-1']);
  });

  it('ergibt aufsteigende Stundengruppen mit nach unten wachsender Nummer', () => {
    const zeilen = baueZeilen({
      eintraege: [
        e({ id: 3, lfd_nr: 3, ereigniszeit: '2026-05-23 14:20:00' }),
        e({ id: 2, lfd_nr: 2, ereigniszeit: '2026-05-23 14:10:00' }),
        e({ id: 1, lfd_nr: 1, ereigniszeit: '2026-05-23 13:50:00' }),
      ],
      ausstehend: [],
      abgelehnt: [],
    });
    const gruppen = gruppiereNachStunde(funkprotokollFolge(zeilen), stunde, kopf);
    expect(gruppen.map((g) => g.etikett)).toEqual(['1300', '1400']);
    expect(gruppen[1].zeilen.map((z) => (z.art === 'eintrag' ? z.eintrag.lfd_nr : null))).toEqual([
      2, 3,
    ]);
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

describe('Bilanz und Kopfzahl — exakt aus der Serverzählung (LFH-612)', () => {
  const null_je_typ = {
    meldung: 0,
    anordnung: 0,
    lage: 0,
    entscheidung: 0,
    system: 0,
    berichtigung: 0,
  };

  it('ordnet die Typen fest und zeigt System nur, wenn es vorkommt', () => {
    const ohne = typBilanz({ ...null_je_typ, meldung: 218, lage: 62 });
    expect(ohne.map((z) => [z.typ, z.anzahl])).toEqual([
      ['meldung', 218],
      ['anordnung', 0],
      ['entscheidung', 0],
      ['lage', 62],
      ['berichtigung', 0],
    ]);
    const mit = typBilanz({ ...null_je_typ, system: 1 });
    expect(mit[mit.length - 1]).toEqual({ typ: 'system', anzahl: 1 });
  });

  it.each([
    [{ gesamt: 412, filterAktiv: false }, '412 Einträge'],
    [{ gesamt: 1, filterAktiv: false }, '1 Eintrag'],
    [{ gesamt: 7, filterAktiv: true }, '7 Treffer'],
    [{ gesamt: 1, filterAktiv: true }, '1 Treffer'],
    [{ gesamt: 0, filterAktiv: true }, '0 Treffer'],
  ])('Kopf-Meta %#', (args, text) => {
    expect(kopfMeta(args)).toBe(text);
  });

  it('behauptet ohne Zählung keine Zahl', () => {
    expect(kopfMeta({ gesamt: undefined, filterAktiv: false })).toBeUndefined();
    expect(kopfMeta({ gesamt: undefined, filterAktiv: true })).toBeUndefined();
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

describe('Ausschluss der Systemeinträge (LFH-958)', () => {
  it('Ausschalten entfernt den Schlüssel, statt `false` mitzuführen', () => {
    expect(
      filterZusammenfuehren({ q: 'a', ohne_system: true }, { ohne_system: undefined }),
    ).toEqual({ q: 'a' });
  });

  it('der Ausschluss hebt typ=system auf, andere Typen bleiben', () => {
    expect(filterZusammenfuehren({ typ: 'system' }, { ohne_system: true })).toEqual({
      ohne_system: true,
    });
    expect(filterZusammenfuehren({ typ: 'lage' }, { ohne_system: true })).toEqual({
      typ: 'lage',
      ohne_system: true,
    });
  });

  it('das Segment `system` hebt den Ausschluss auf, jedes andere Segment behält ihn', () => {
    expect(filterMitTyp({ ohne_system: true }, 'system')).toEqual({ typ: 'system' });
    expect(filterZusammenfuehren({ ohne_system: true }, { typ: 'system' })).toEqual({
      typ: 'system',
    });
    expect(filterMitTyp({ ohne_system: true }, 'meldung')).toEqual({
      ohne_system: true,
      typ: 'meldung',
    });
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
   * Ein Deeplink auf einen nicht geladenen Grundeintrag lädt ÄLTERE Seiten nach, während der
   * Fokus im Verweis liegt. Die kommen UNTEN an und können nicht unter dem Cursor springen;
   * zurückgehalten meldete das Banner sie als „neu", und der Sprung fände seine Zeile nicht.
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
   * Der eigene gepufferte Eintrag wird gesendet — die Pufferzeile geht, die Serverzeile kommt
   * mit neuem Schlüssel. Hielte die Achse sie zurück, wäre der eigene Eintrag für diesen Moment
   * nirgends zu sehen.
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
    // Böden als Literale (LFH-365): aus dem Token zurückgelesen prüfte die Zusicherung den Token
    // gegen sich selbst.
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
    // LLH-1104: Meldung und Nachforderung sind Kopplungen wie Befehl und Auftrag.
    expect(hatVerknuepfung(e({ meldung_id: 4, meldung_lfd_nr: 12 }))).toBe(true);
    expect(hatVerknuepfung(e({ nachforderung_id: 7 }))).toBe(true);
    // LLH-1266: genannte Einheiten ebenso.
    expect(hatVerknuepfung(e({ einheiten: [{ id: 20, name: 'Florian 1' }] }))).toBe(true);
  });
});

describe('dokumenteJeEintrag (LFH-743)', () => {
  const dok = (id: number, bezug?: number) => ({ id, bezug_etb_eintrag_id: bezug });

  it('ordnet die Dokumente ihrem ETB-Bezug zu und lässt die übrigen weg', () => {
    const je = dokumenteJeEintrag([dok(1, 40), dok(2), dok(3, 41), dok(4, 40)]);
    expect([...je.keys()].sort()).toEqual([40, 41]);
    expect(je.get(40)?.map((d) => d.id)).toEqual([1, 4]);
    expect(je.get(41)?.map((d) => d.id)).toEqual([3]);
  });

  it('liefert ohne Dokument mit ETB-Bezug eine leere Zuordnung', () => {
    expect(dokumenteJeEintrag([dok(1), dok(2)]).size).toBe(0);
    expect(dokumenteJeEintrag([]).size).toBe(0);
  });
});

describe('berichtigungTitel (LLH-1099)', () => {
  it('nennt den Eintrag, an einer Berichtigung auch die Kette', () => {
    expect(berichtigungTitel(e({ lfd_nr: 134 }), null)).toBe('Berichtigung zu Nr. 134');
    const b = e({ lfd_nr: 135, typ: 'berichtigung', berichtigt_eintrag_id: 1 });
    expect(berichtigungTitel(b, 134)).toBe('Berichtigung zu Nr. 135 (berichtigt Nr. 134)');
    expect(berichtigungTitel(b, null)).toBe(
      'Berichtigung zu Nr. 135 (berichtigt einen älteren Eintrag)',
    );
  });
});

describe('buendleSystemfolgen (LLH-1106)', () => {
  const sys = (id: number, over: Partial<EtbEintragAnzeige> = {}) =>
    e({ id, lfd_nr: id, typ: 'system', von: 'System', an: 'System', ...over });
  // Funkprotokoll-Ordnung: älteste zuerst, wie die Zeitachse sie nach dem Kehren gruppiert.
  const zeilenAus = (eintraege: EtbEintragAnzeige[]) =>
    funkprotokollFolge(
      baueZeilen({ eintraege: [...eintraege].reverse(), ausstehend: [], abgelehnt: [] }),
    );
  const arten = (posten: ReturnType<typeof buendleSystemfolgen>) =>
    posten.map((p) =>
      p.art === 'buendel'
        ? `B${p.zeilen.length}`
        : p.art === 'eintrag'
          ? `e${p.eintrag.id}`
          : p.art,
    );

  it('lässt zwei Systemeinträge stehen und bündelt ab drei', () => {
    expect(arten(buendleSystemfolgen(zeilenAus([sys(1), sys(2)]), {}))).toEqual(['e1', 'e2']);
    const drei = buendleSystemfolgen(zeilenAus([sys(1), sys(2), sys(3)]), {});
    expect(arten(drei)).toEqual(['B3']);
  });

  it('schlüsselt das Bündel nach seinem ältesten Eintrag: es wächst unten, der Schlüssel bleibt', () => {
    const drei = buendleSystemfolgen(zeilenAus([sys(1), sys(2), sys(3)]), {});
    const vier = buendleSystemfolgen(zeilenAus([sys(1), sys(2), sys(3), sys(4)]), {});
    expect(drei[0].schluessel).toBe(vier[0].schluessel);
  });

  it('bricht an einem anderen Typ: zwei Paare um eine Meldung bilden kein Bündel', () => {
    const posten = buendleSystemfolgen(
      zeilenAus([sys(1), sys(2), e({ id: 3, lfd_nr: 3 }), sys(4), sys(5)]),
      {},
    );
    expect(arten(posten)).toEqual(['e1', 'e2', 'e3', 'e4', 'e5']);
  });

  it('bricht an einem berichtigten, nachgetragenen, angehängten oder verknüpften Eintrag', () => {
    const brecher: Partial<EtbEintragAnzeige>[] = [
      { berichtigt_durch: [{ id: 9, lfd_nr: 9 }] },
      { received_at: '2026-05-23 10:30:00' },
      { anhaenge: [{ id: 1 } as EtbEintragAnzeige['anhaenge'][number]] },
      { auftrag_id: 7 },
      // Der Eintrag der Auflösung mit Verweis auf die Einheit steht einzeln (LLH-1266).
      { einheiten: [{ id: 20, name: 'Florian 1' }] },
    ];
    for (const over of brecher) {
      const posten = buendleSystemfolgen(
        zeilenAus([sys(1), sys(2), sys(3, over), sys(4), sys(5)]),
        {},
      );
      expect(arten(posten), JSON.stringify(over)).toEqual(['e1', 'e2', 'e3', 'e4', 'e5']);
    }
  });

  it('bricht an einem Eintrag mit Dokument der Ablage', () => {
    const posten = buendleSystemfolgen(zeilenAus([sys(1), sys(2), sys(3), sys(4)]), {
      hatDokument: (id) => id === 2,
    });
    expect(arten(posten)).toEqual(['e1', 'e2', 'e3', 'e4']);
  });

  it('bricht nach der Lesemarke, damit die Linie nicht im Bündel verschwindet', () => {
    const posten = buendleSystemfolgen(
      zeilenAus([sys(1), sys(2), sys(3), sys(4), sys(5), sys(6)]),
      {
        brichtNach: (z) => z.art === 'eintrag' && z.eintrag.id === 3,
      },
    );
    expect(arten(posten)).toEqual(['B3', 'B3']);
  });

  it('bündelt nicht, wenn es aus ist (Typfilter System, Volltext)', () => {
    const posten = buendleSystemfolgen(zeilenAus([sys(1), sys(2), sys(3)]), { aus: true });
    expect(arten(posten)).toEqual(['e1', 'e2', 'e3']);
  });

  it('nimmt gepufferte Zeilen nie ins Bündel', () => {
    const zeilen = [
      ...zeilenAus([sys(1), sys(2)]),
      ...baueZeilen({ eintraege: [], ausstehend: [puffer], abgelehnt: [] }),
      ...zeilenAus([sys(3)]),
    ];
    expect(arten(buendleSystemfolgen(zeilen, {}))).toEqual(['e1', 'e2', 'ausstehend', 'e3']);
  });
});

describe('nachtragText (LLH-1088)', () => {
  const berlin = { ...DEFAULT_KONVENTIONEN, zeitzone: 'Europe/Berlin' };

  it('nennt am selben Tag die Uhrzeit, über Mitternacht den Tag in taktischer Form', () => {
    // 10.10. 23:50 und 11.10. 00:20 in Berlin (UTC+2).
    expect(nachtragText('2026-10-10 21:50:00', '2026-10-10 22:20:00', berlin)).toBe(
      'nachgetragen 110020',
    );
    expect(nachtragText('2026-10-10 10:00:00', '2026-10-10 12:21:00', berlin)).toBe(
      'nachgetragen um 1421',
    );
  });

  it('bestimmt den Tag in der Anzeigezone, nicht in UTC', () => {
    // In UTC derselbe Tag (21:50 / 23:10), in Berlin schon der 11.
    expect(nachtragText('2026-10-10 21:50:00', '2026-10-10 23:10:00', berlin)).toBe(
      'nachgetragen 110110',
    );
  });

  it('folgt der Darstellung „Datum und Uhrzeit“ (LLH-1061)', () => {
    const datum = { ...berlin, zeitdarstellung: 'datum_uhrzeit' as const };
    expect(nachtragText('2026-10-10 21:50:00', '2026-10-10 22:20:00', datum)).toBe(
      'nachgetragen 11.10. 00:20',
    );
    expect(nachtragText('2026-10-10 10:00:00', '2026-10-10 12:21:00', datum)).toBe(
      'nachgetragen um 14:21',
    );
  });
});
