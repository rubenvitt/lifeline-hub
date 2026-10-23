import { describe, expect, it } from 'vitest';
import type { EinheitPerioden, Einheit, EinsatzFahrzeug, ErwarteteKraft } from '../../api/types';
import {
  buildEintreffenEingabe,
  buildEintreffenGruppen,
  buildNachgefordertZeilen,
  findDoppelbuchung,
  kraftEingabe,
  nachgefordertHinweise,
  nachgefordertZiel,
  normalizeFunkrufname,
  trefferHinweise,
  type EintreffenTreffer,
} from './eintreffenKern';

const einheit = (id: number, name: string, mehr: Partial<Einheit> = {}): Einheit =>
  ({
    id,
    name,
    abschnitt_id: null,
    abschnitt_name: null,
    ueber_einheit_id: null,
    aktueller_br_id: null,
    funkrufname: null,
    typ_label: null,
    fahrzeug_mitglieder: [],
    unangemeldet: false,
    ...mehr,
  }) as unknown as Einheit;

const fahrzeug = (id: number, funkrufname: string, mehr: Partial<EinsatzFahrzeug> = {}) =>
  ({
    id,
    funkrufname,
    einheit_id: null,
    aktueller_br_id: null,
    fahrzeugtyp: null,
    ...mehr,
  }) as unknown as EinsatzFahrzeug;

const mitglied = (funkrufname: string, id = 90) =>
  ({ einsatz_fahrzeug_id: id, funkrufname }) as unknown as Einheit['fahrzeug_mitglieder'][number];

const offen = (
  einheit_id: number,
  p: { anker?: 'alarmierung' | 'eintreffen'; beginn_at?: string; eintreffen_at?: string | null },
): EinheitPerioden => ({
  einheit_id,
  perioden: [
    {
      anker: p.anker ?? 'alarmierung',
      beginn_at: p.beginn_at ?? '2026-10-16T11:42:00',
      eintreffen_at: p.eintreffen_at ?? null,
      ende_at: null,
      ende_art: null,
    },
  ],
});

const namen = (t: readonly EintreffenTreffer[]) => t.map((x) => x.name);

describe('buildEintreffenGruppen (LLH-1075, design.md D13)', () => {
  it('Einheit ohne Abschnitt und ohne Eintreffen ist erwartet', () => {
    const g = buildEintreffenGruppen({ einheiten: [einheit(1, 'HLF 20 FF Musterstadt')] });
    expect(namen(g.erwartet)).toEqual(['HLF 20 FF Musterstadt']);
    expect(g.imEinsatz).toEqual([]);
  });

  it('Einheit mit Abschnitt steht nur unter „Im Einsatz“', () => {
    const g = buildEintreffenGruppen({
      einheiten: [einheit(1, 'Zug Nord', { abschnitt_id: 3, abschnitt_name: 'Nord' })],
    });
    expect(g.erwartet).toEqual([]);
    expect(namen(g.imEinsatz)).toEqual(['Zug Nord']);
    expect(g.imEinsatz[0].abschnitt).toBe('Nord');
  });

  it('erbt den Abschnitt der Über-Einheit (Lesart des Meldebilds)', () => {
    const g = buildEintreffenGruppen({
      einheiten: [
        einheit(1, 'Zug Nord', { abschnitt_id: 3, abschnitt_name: 'Nord', aktueller_br_id: 8 }),
        einheit(2, 'Staffel 1', { ueber_einheit_id: 1 }),
      ],
    });
    expect(namen(g.imEinsatz)).toEqual(['Staffel 1']);
    expect(g.imEinsatz[0].abschnitt).toBe('Nord');
  });

  it('Einheit mit Eintreffen in der offenen Periode ist nicht erwartet', () => {
    const g = buildEintreffenGruppen({
      einheiten: [einheit(1, 'ELW 1'), einheit(2, 'GW-L')],
      perioden: [offen(1, { eintreffen_at: '2026-10-16T12:00:00' }), offen(2, {})],
    });
    expect(namen(g.erwartet)).toEqual(['GW-L']);
    expect(namen(g.imEinsatz)).toEqual(['ELW 1']);
    expect(g.imEinsatz[0].eingetroffenAt).toBe('2026-10-16T12:00:00');
    expect(g.erwartet[0].alarmiertAt).toBe('2026-10-16T11:42:00');
  });

  it('eine abgeschlossene Periode zählt nicht als Eintreffen', () => {
    const g = buildEintreffenGruppen({
      einheiten: [einheit(1, 'ELW 1')],
      perioden: [
        {
          einheit_id: 1,
          perioden: [
            {
              anker: 'eintreffen',
              beginn_at: '2026-10-16T08:00:00',
              eintreffen_at: '2026-10-16T08:00:00',
              ende_at: '2026-10-16T10:00:00',
              ende_art: 'entlassung',
            },
          ],
        },
      ],
    });
    expect(namen(g.erwartet)).toEqual(['ELW 1']);
    expect(g.erwartet[0].alarmiertAt).toBeNull();
  });

  it('eine Periode mit Anker Eintreffen nennt keine Alarmierung', () => {
    const g = buildEintreffenGruppen({
      einheiten: [einheit(1, 'ELW 1', { abschnitt_id: 2 })],
      perioden: [offen(1, { anker: 'eintreffen', eintreffen_at: '2026-10-16T12:00:00' })],
    });
    expect(g.imEinsatz[0].alarmiertAt).toBeNull();
  });

  it('Kräfte in einem Raum werden nicht angeboten', () => {
    const g = buildEintreffenGruppen({
      einheiten: [einheit(1, 'Zug 1', { aktueller_br_id: 4 }), einheit(2, 'Zug 2')],
      fahrzeuge: [fahrzeug(5, 'Florian 1', { aktueller_br_id: 4 }), fahrzeug(6, 'Florian 2')],
      // Detail-Cache kennt die Einheit 2 schon im Raum, die Liste noch nicht.
      imRaum: { einheiten: [2], fahrzeuge: [] },
    });
    expect(namen(g.erwartet)).toEqual(['Florian 2']);
  });

  it('einheitenlose Fahrzeuge sind erwartet, Fahrzeuge einer Einheit erscheinen nicht einzeln', () => {
    const g = buildEintreffenGruppen({
      einheiten: [einheit(1, 'Zug 1', { fahrzeug_mitglieder: [mitglied('Florian 1')] })],
      fahrzeuge: [fahrzeug(5, 'Florian 1', { einheit_id: 1 }), fahrzeug(6, 'RTW 2')],
    });
    expect(g.erwartet.map((t) => [t.art, t.name])).toEqual([
      ['fahrzeug', 'RTW 2'],
      ['einheit', 'Zug 1'],
    ]);
  });

  it('aufgelöste Einheiten und beendete Fahrzeuge fehlen', () => {
    const g = buildEintreffenGruppen({
      einheiten: [einheit(1, 'Alt', { aufgeloest_at: '2026-10-16T09:00:00' })],
      fahrzeuge: [fahrzeug(5, 'Weg', { beendet_at: '2026-10-16T09:00:00' })],
    });
    expect(g.erwartet).toEqual([]);
    expect(g.imEinsatz).toEqual([]);
  });

  it('sortiert je Gruppe natürlich nach Name', () => {
    const g = buildEintreffenGruppen({
      einheiten: [einheit(1, 'Zug 10'), einheit(2, 'Zug 2'), einheit(3, 'ELW')],
    });
    expect(namen(g.erwartet)).toEqual(['ELW', 'Zug 2', 'Zug 10']);
  });

  it('eine offline vorgemerkte Kraft trägt den Zeitpunkt der Vormerkung (LLH-1075 Teil III)', () => {
    const g = buildEintreffenGruppen({
      einheiten: [einheit(1, 'HLF 20'), einheit(2, 'ELW 1')],
      fahrzeuge: [fahrzeug(6, 'RTW 2')],
      vorgemerkt: [
        { kraft: { objekt_typ: 'einheit', objekt_id: 1 }, zeitpunkt_at: '2026-10-16 12:12:00' },
        { kraft: { objekt_typ: 'fahrzeug', objekt_id: 6 }, zeitpunkt_at: '2026-10-16 12:13:00' },
        { unangemeldet: { fahrzeuge: [{ funkrufname: 'ELW 1' }] } },
      ],
    });
    expect(g.erwartet.map((t) => [t.name, t.vorgemerktAt])).toEqual([
      ['ELW 1', null],
      ['HLF 20', '2026-10-16 12:12:00'],
      ['RTW 2', '2026-10-16 12:13:00'],
    ]);
  });

  describe('Suche', () => {
    const daten = {
      einheiten: [
        einheit(1, 'HLF 20 FF Musterstadt', {
          funkrufname: 'Florian Musterstadt 1',
          fahrzeug_mitglieder: [mitglied('FL-MUS 1-44-1')],
        }),
        einheit(2, 'Zug Nord', { typ_label: 'Zug' }),
      ],
      fahrzeuge: [fahrzeug(6, 'RTW 2', { fahrzeugtyp: 'RTW' })],
    };

    it('findet über Name und Typ', () => {
      expect(namen(buildEintreffenGruppen({ ...daten, suche: 'hlf' }).erwartet)).toEqual([
        'HLF 20 FF Musterstadt',
      ]);
      expect(namen(buildEintreffenGruppen({ ...daten, suche: 'zug' }).erwartet)).toEqual([
        'Zug Nord',
      ]);
      expect(namen(buildEintreffenGruppen({ ...daten, suche: 'rtw' }).erwartet)).toEqual(['RTW 2']);
    });

    it('der Funkrufname eines Fahrzeugs findet seine Einheit', () => {
      expect(namen(buildEintreffenGruppen({ ...daten, suche: '1-44' }).erwartet)).toEqual([
        'HLF 20 FF Musterstadt',
      ]);
    });

    it('„fl-mus  1-44-1“ trifft „FL-MUS 1-44-1“ (Groß/Klein und Leerzeichen gleich)', () => {
      expect(
        namen(buildEintreffenGruppen({ ...daten, suche: '  fl-mus  1-44-1 ' }).erwartet),
      ).toEqual(['HLF 20 FF Musterstadt']);
    });

    it('der Funkrufname der Einheit findet sie', () => {
      expect(
        namen(buildEintreffenGruppen({ ...daten, suche: 'florian musterstadt' }).erwartet),
      ).toEqual(['HLF 20 FF Musterstadt']);
    });

    it('trägt die Funkrufnamen und den Typ eines Treffers', () => {
      const [t] = buildEintreffenGruppen({ ...daten, suche: 'hlf' }).erwartet;
      expect(t.funkrufnamen).toEqual(['FL-MUS 1-44-1']);
      const [r] = buildEintreffenGruppen({ ...daten, suche: 'rtw' }).erwartet;
      expect(r.typ).toBe('RTW');
    });
  });
});

describe('trefferHinweise', () => {
  const zeit = (w: string) => w.slice(11, 13) + w.slice(14, 16);
  const basis: EintreffenTreffer = {
    art: 'einheit',
    id: 1,
    name: 'Zug',
    funkrufnamen: [],
    typ: null,
    abschnitt: null,
    alarmiertAt: null,
    eingetroffenAt: null,
    vorgemerktAt: null,
  };

  it('eine offline vorgemerkte Kraft nennt zuerst die Vormerkung (LLH-1075 Teil III)', () => {
    expect(
      trefferHinweise(
        { ...basis, vorgemerktAt: '2026-10-16 14:12:00', alarmiertAt: '2026-10-16T13:42:00' },
        zeit,
      ),
    ).toEqual(['vorgemerkt 1412', 'alarmiert 1342']);
  });

  it('nennt Alarmierung, Abschnitt und Eintreffen in dieser Folge', () => {
    expect(
      trefferHinweise(
        {
          ...basis,
          alarmiertAt: '2026-10-16T13:42:00',
          abschnitt: 'Nord',
          eingetroffenAt: '2026-10-16T14:00:00',
        },
        zeit,
      ),
    ).toEqual(['alarmiert 1342', 'Nord', 'eingetroffen 1400']);
  });

  it('ohne Angaben keine Hinweise', () => {
    expect(trefferHinweise(basis, zeit)).toEqual([]);
  });
});

describe('normalizeFunkrufname', () => {
  it('trimmt, vereinheitlicht Leerzeichen und faltet Groß/Klein', () => {
    expect(normalizeFunkrufname('  FL-MUS   1-44-1 ')).toBe('fl-mus 1-44-1');
    expect(normalizeFunkrufname('Müller\t1')).toBe(normalizeFunkrufname('MÜLLER 1'));
  });
});

describe('findDoppelbuchung (D9)', () => {
  const einheiten = [
    einheit(1, 'HLF 20 FF Musterstadt', {
      funkrufname: 'Florian Musterstadt 1',
      fahrzeug_mitglieder: [mitglied('FL-MUS 1-44-1', 5)],
    }),
    einheit(2, 'Zug Süd', { aktueller_br_id: 9 }),
  ];
  const fahrzeuge = [
    fahrzeug(5, 'FL-MUS 1-44-1', { einheit_id: 1 }),
    fahrzeug(6, 'RTW 2'),
    fahrzeug(7, 'Alt', { beendet_at: '2026-10-16T09:00:00' }),
  ];
  const kandidaten = buildEintreffenGruppen({ einheiten, fahrzeuge });

  it('ein leerer Funkrufname trifft nichts', () => {
    expect(findDoppelbuchung('  ', { einheiten, fahrzeuge, kandidaten })).toBeNull();
  });

  it('ein Fahrzeug einer Einheit nennt das Fahrzeug und bucht die Einheit', () => {
    const d = findDoppelbuchung('fl-mus  1-44-1', { einheiten, fahrzeuge, kandidaten });
    expect(d?.name).toBe('FL-MUS 1-44-1');
    expect(d?.treffer?.art).toBe('einheit');
    expect(d?.treffer?.id).toBe(1);
  });

  it('trifft Name und Funkrufname einer Einheit', () => {
    expect(
      findDoppelbuchung('florian musterstadt 1', { einheiten, fahrzeuge, kandidaten })?.name,
    ).toBe('HLF 20 FF Musterstadt');
    expect(findDoppelbuchung('ZUG SÜD', { einheiten, fahrzeuge, kandidaten })?.name).toBe(
      'Zug Süd',
    );
  });

  it('eine Kraft in einem Raum ist kein buchbarer Treffer', () => {
    const d = findDoppelbuchung('Zug Süd', { einheiten, fahrzeuge, kandidaten });
    expect(d?.treffer).toBeNull();
  });

  it('ein einheitenloses Fahrzeug ist buchbar', () => {
    const d = findDoppelbuchung('rtw 2', { einheiten, fahrzeuge, kandidaten });
    expect(d?.treffer).toMatchObject({ art: 'fahrzeug', id: 6 });
  });

  it('beendete Fahrzeuge zählen nicht', () => {
    expect(findDoppelbuchung('Alt', { einheiten, fahrzeuge, kandidaten })).toBeNull();
  });

  it('ein Teilstück trifft nicht', () => {
    expect(findDoppelbuchung('RTW', { einheiten, fahrzeuge, kandidaten })).toBeNull();
  });

  it('eine Kraft aus dem Einsatz ist nicht vorgemerkt', () => {
    expect(findDoppelbuchung('rtw 2', { einheiten, fahrzeuge, kandidaten })?.vorgemerkt).toBe(
      false,
    );
  });

  describe('ohne Netz vorgemerkt (LLH-1075 Teil III)', () => {
    const vorgemerkt = [
      {
        kraft: { objekt_typ: 'fahrzeug' as const, objekt_id: 6 },
        zeitpunkt_at: '2026-10-16 12:12:00',
      },
      {
        unangemeldet: {
          fahrzeuge: [{ funkrufname: 'FL-MUS 2-44-1' }, { funkrufname: 'FL-MUS 2-19-1' }],
        },
        zeitpunkt_at: '2026-10-16 12:13:00',
      },
    ];
    const mitVormerkung = buildEintreffenGruppen({ einheiten, fahrzeuge, vorgemerkt });

    it('eine schon vorgemerkte Kraft bietet „Diese buchen“ nicht noch einmal an', () => {
      const d = findDoppelbuchung('RTW 2', {
        einheiten,
        fahrzeuge,
        kandidaten: mitVormerkung,
        vorgemerkt,
      });
      expect(d).toEqual({ name: 'RTW 2', treffer: null, vorgemerkt: true });
    });

    it('eine vorgemerkte unangemeldete Kraft ist noch keine buchbare Kraft', () => {
      for (const eingabe of ['fl-mus 2-44-1', 'FL-MUS  2-19-1']) {
        const d = findDoppelbuchung(eingabe, {
          einheiten,
          fahrzeuge,
          kandidaten: mitVormerkung,
          vorgemerkt,
        });
        expect(d, eingabe).toEqual({
          name: eingabe.includes('19') ? 'FL-MUS 2-19-1' : 'FL-MUS 2-44-1',
          treffer: null,
          vorgemerkt: true,
        });
      }
    });

    it('ohne Kräfte des Einsatzes erfindet die Prüfung keine Doppelbuchung', () => {
      expect(
        findDoppelbuchung('HLF 20 FF Musterstadt', {
          einheiten: [],
          fahrzeuge: [],
          kandidaten: buildEintreffenGruppen({}),
          vorgemerkt: [],
        }),
      ).toBeNull();
    });
  });
});

describe('kraftEingabe', () => {
  it('bucht eine bekannte Kraft über `kraft`', () => {
    expect(
      kraftEingabe({
        art: 'einheit',
        id: 3,
        name: 'Zug',
        funkrufnamen: [],
        typ: null,
        abschnitt: null,
        alarmiertAt: null,
        eingetroffenAt: null,
        vorgemerktAt: null,
      }),
    ).toEqual({ kraft: { objekt_typ: 'einheit', objekt_id: 3 } });
  });
});

describe('buildEintreffenEingabe', () => {
  it('lässt leere Felder weg und trimmt', () => {
    expect(
      buildEintreffenEingabe({ funkrufname: ' FL-MUS 1-44-1 ', traegerorganisation: ' ' }),
    ).toEqual({
      unangemeldet: { fahrzeuge: [{ funkrufname: 'FL-MUS 1-44-1' }] },
    });
  });

  it('setzt die Organisation in jedes Fahrzeug und nimmt weitere Fahrzeuge mit', () => {
    expect(
      buildEintreffenEingabe({
        funkrufname: 'FL-MUS 1-44-1',
        traegerorganisation: 'FF Musterstadt',
        fahrzeugtyp: 'HLF 20',
        staerke: { fuehrer: 1, unterfuehrer: 1, mannschaft: 7 },
        bemerkung: ' Kommt aus Übung ',
        weitere: [{ funkrufname: 'FL-MUS 1-19-1', fahrzeugtyp: '' }, { funkrufname: '  ' }],
      }),
    ).toEqual({
      unangemeldet: {
        fahrzeuge: [
          {
            funkrufname: 'FL-MUS 1-44-1',
            fahrzeugtyp: 'HLF 20',
            traegerorganisation: 'FF Musterstadt',
          },
          { funkrufname: 'FL-MUS 1-19-1', traegerorganisation: 'FF Musterstadt' },
        ],
        staerke: { fuehrer: 1, unterfuehrer: 1, mannschaft: 7 },
        bemerkung: 'Kommt aus Übung',
      },
    });
  });

  it('bestätigt die Neuanlage nur auf Wunsch', () => {
    expect(
      buildEintreffenEingabe({ funkrufname: 'X' }, { trotzdemAnlegen: true }).unangemeldet,
    ).toMatchObject({ trotzdem_anlegen: true });
    expect(buildEintreffenEingabe({ funkrufname: 'X' }).unangemeldet).not.toHaveProperty(
      'trotzdem_anlegen',
    );
  });

  it('eine leere Stärke geht nicht mit', () => {
    expect(
      buildEintreffenEingabe({ funkrufname: 'X', staerke: null }).unangemeldet,
    ).not.toHaveProperty('staerke');
  });
});

const erwartet = (mehr: Partial<ErwarteteKraft> = {}): ErwarteteKraft => ({
  nachforderung_id: 4,
  art: 'RTW',
  anzahl: 2,
  status: 'unterwegs',
  rufnamen: ['83-1', '83-2'],
  offen: 2,
  ...mehr,
});

describe('buildNachgefordertZeilen (LLH-1387, design.md D6)', () => {
  it('eine Zeile je offenem Rufnamen mit Kurzname der Nachforderung', () => {
    const z = buildNachgefordertZeilen([erwartet()]);
    expect(z.map((x) => [x.rufname, x.kurz, x.nachforderungId])).toEqual([
      ['83-1', '2× RTW', 4],
      ['83-2', '2× RTW', 4],
    ]);
  });

  it('mehr offen als Rufnamen: dazu eine Zeile ohne Rufname', () => {
    const z = buildNachgefordertZeilen([erwartet({ rufnamen: ['83-1'], offen: 2 })]);
    expect(z.map((x) => x.rufname)).toEqual(['83-1', null]);
  });

  it('ohne Anzahl und ohne Rufnamen eine Zeile ohne Rufname, mit Rufnamen keine', () => {
    const ohne = erwartet({ anzahl: undefined, offen: undefined, rufnamen: [] });
    expect(buildNachgefordertZeilen([ohne]).map((x) => [x.rufname, x.kurz])).toEqual([
      [null, 'RTW'],
    ]);
    const mit = erwartet({ anzahl: undefined, offen: undefined, rufnamen: ['83-1'] });
    expect(buildNachgefordertZeilen([mit]).map((x) => x.rufname)).toEqual(['83-1']);
  });

  it('die Suche trifft Rufname und Art', () => {
    const liste = [erwartet(), erwartet({ nachforderung_id: 5, art: 'SEG', rufnamen: ['Sani 1'] })];
    expect(buildNachgefordertZeilen(liste, ' 83-2').map((x) => x.rufname)).toEqual(['83-2']);
    expect(buildNachgefordertZeilen(liste, 'seg').map((x) => x.rufname)).toEqual(['Sani 1', null]);
  });
});

describe('nachgefordertHinweise', () => {
  it('nennt Nachforderung, Stufe und erwartetes Eintreffen', () => {
    const [z] = buildNachgefordertZeilen([
      erwartet({ status: 'zugesagt', eintreffen_erwartet_at: '2026-10-22 15:30:00' }),
    ]);
    expect(nachgefordertHinweise(z!, (w) => `um ${w}`)).toEqual([
      'Nachforderung 2× RTW',
      'zugesagt',
      'erwartet um 2026-10-22 15:30:00',
    ]);
  });
});

describe('nachgefordertZiel', () => {
  const kandidaten = (einheiten: Einheit[]) => ({
    einheiten,
    fahrzeuge: [],
    kandidaten: buildEintreffenGruppen({ einheiten }),
  });

  it('eine gleichnamige buchbare Einheit wird gebucht', () => {
    const [z] = buildNachgefordertZeilen([erwartet()]);
    const ziel = nachgefordertZiel(z!, kandidaten([einheit(7, '83-1')]));
    expect(ziel).toMatchObject({ art: 'buchen', treffer: { art: 'einheit', id: 7 } });
  });

  it('ohne gleichnamige Kraft oder ohne Rufname geht es zur Neuanlage', () => {
    const [a, , ohne] = buildNachgefordertZeilen([erwartet({ offen: 3 })]);
    expect(nachgefordertZiel(a!, kandidaten([])).art).toBe('neu');
    expect(nachgefordertZiel(ohne!, kandidaten([einheit(7, '83-1')])).art).toBe('neu');
  });

  it('eine vorgemerkte Buchung desselben Rufnamens ist vorgemerkt', () => {
    const [z] = buildNachgefordertZeilen([erwartet()]);
    const ziel = nachgefordertZiel(z!, {
      ...kandidaten([]),
      vorgemerkt: [{ unangemeldet: { fahrzeuge: [{ funkrufname: '83-1' }] } }],
    });
    expect(ziel.art).toBe('vorgemerkt');
  });
});

describe('buildEintreffenEingabe mit Nachforderung (LLH-1387)', () => {
  it('trägt den Verweis mit', () => {
    expect(
      buildEintreffenEingabe({ funkrufname: '83-1' }, { nachforderungId: 4 }).nachforderung_id,
    ).toBe(4);
    expect(buildEintreffenEingabe({ funkrufname: '83-1' })).not.toHaveProperty('nachforderung_id');
  });
});
