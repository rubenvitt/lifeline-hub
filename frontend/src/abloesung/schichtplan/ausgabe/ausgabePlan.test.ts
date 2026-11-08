import { describe, expect, it } from 'vitest';
import type { Schichtplan, SchichtplanBlock, SchichtplanPerson } from '../../../api/types';
import type { RasterZeile } from '../raster';
import { ausEinsatzPlan } from './ausEinsatzPlan';
import { aushaenge, besetzungText, mehrereTage, sollText, zettel } from './ausgabePlan';

const person = (p: Partial<SchichtplanPerson> & { name: string }): SchichtplanPerson => ({
  art: 'stamm',
  befunde: [],
  im_einsatz: true,
  qualifikationen: [],
  ...p,
});

const anna = person({ name: 'Anna Aushang', personal_id: 1, qualifikationen: [5] });
const ben = person({ name: 'Ben Berg', art: 'einsatz', einsatz_personal_id: 2 });
const cora = person({ name: 'Cora Clausen', art: 'helfer', helfer_id: 3 });

let naechsteId = 1;
const block = (b: Partial<SchichtplanBlock> = {}): SchichtplanBlock => ({
  id: naechsteId++,
  von: '2026-08-15 12:00:00',
  bis: '2026-08-15 15:00:00',
  posten: { art: 'uhs', uhs_id: 9, bezeichnung: 'UHS Marktplatz', aufgeloest: false },
  befunde: [],
  offene_anforderungen: [],
  offene_plaetze: 0,
  personen: [],
  personen_anzahl: 0,
  soll_anzahl: null,
  version: 1,
  ...b,
});

const ZEILEN: RasterZeile[] = [
  { schluessel: 'einheit:4', titel: 'Fußstreife 1', gruppe: 'Innenstadt' },
  { schluessel: 'uhs:9', titel: 'UHS Marktplatz', gruppe: 'Innenstadt' },
  { schluessel: 'einheit:6', titel: 'RTW 1', gruppe: 'Ohne Abschnitt' },
  { schluessel: 'pause', titel: 'Pause', gruppe: null, ueberlappungErlaubt: true },
];

const plan = (bloecke: SchichtplanBlock[], mitNamen = true): Schichtplan => ({
  grenzwerte: {
    max_dienst_minuten: 720,
    min_ruhe_minuten: 480,
    max_dienst_eigen: false,
    min_ruhe_eigen: false,
  },
  bloecke: mitNamen ? bloecke : bloecke.map((b) => ({ ...b, personen: null })),
  helfer: mitNamen
    ? [
        {
          id: 3,
          name: 'Cora Clausen',
          telefon: '0151 123',
          organisation: 'JUH',
          qualifikationen: [],
        },
      ]
    : null,
});

const STADTFEST = () => [
  // Bewusst nicht in Zeitfolge: die Blätter ordnen selbst.
  block({
    von: '2026-08-15 15:00:00',
    bis: '2026-08-15 18:00:00',
    soll_anzahl: 2,
    quali_soll: [{ qualifikation_id: 5, label: 'Rettungssanitäter', anzahl: 1 }],
    personen: [anna],
    personen_anzahl: 1,
    offene_plaetze: 1,
  }),
  block({
    soll_anzahl: 2,
    quali_soll: [{ qualifikation_id: 5, label: 'Rettungssanitäter', anzahl: 1 }],
    personen: [cora, anna],
    personen_anzahl: 2,
  }),
  block({
    posten: { art: 'einheit', einheit_id: 4, bezeichnung: 'Fußstreife 1', aufgeloest: false },
    von: '2026-08-15 18:00:00',
    bis: '2026-08-15 21:00:00',
    personen: [anna, ben],
    personen_anzahl: 2,
  }),
  block({
    posten: { art: 'pause', aufgeloest: false },
    von: '2026-08-15 21:00:00',
    bis: '2026-08-15 21:30:00',
    personen: [anna],
    personen_anzahl: 1,
  }),
];

describe('Ausgabeplan (LLH-1557)', () => {
  it('Aushang: Posten in Gliederungsfolge, Schichten nach Beginn, ohne Pause und leere Posten', () => {
    const a = aushaenge(ausEinsatzPlan(plan(STADTFEST()), ZEILEN));
    expect(a.map((x) => x.posten.titel)).toEqual(['Fußstreife 1', 'UHS Marktplatz']);
    const uhs = a[1];
    expect(uhs.posten.abschnitt).toBe('Innenstadt');
    expect(uhs.zeilen.map((z) => z.schicht.von)).toEqual([
      '2026-08-15 12:00:00',
      '2026-08-15 15:00:00',
    ]);
    // Namen in deutscher Folge, unabhängig von der Folge im Block.
    expect(uhs.zeilen[0].personen.map((p) => p.name)).toEqual(['Anna Aushang', 'Cora Clausen']);
    expect(uhs.zeilen[1].schicht.offen).toBe(1);
    expect(uhs.soll).toEqual({ anzahl: 2, quali: [{ label: 'Rettungssanitäter', anzahl: 1 }] });
  });

  it('Aushang: unterschiedliches Soll steht je Schicht, nicht im Kopf', () => {
    const b = STADTFEST();
    b[0] = { ...b[0], soll_anzahl: 3 };
    const uhs = aushaenge(ausEinsatzPlan(plan(b), ZEILEN)).find(
      (x) => x.posten.schluessel === 'uhs:9',
    )!;
    expect(uhs.soll).toBeNull();
  });

  it('Zettel: je Person nach Namen, Pause als Zeile, Stunden ohne Pause', () => {
    const z = zettel(ausEinsatzPlan(plan(STADTFEST()), ZEILEN));
    expect(z.map((x) => x.person.name)).toEqual(['Anna Aushang', 'Ben Berg', 'Cora Clausen']);
    const annas = z[0];
    expect(annas.zeilen.map((x) => x.posten.titel)).toEqual([
      'UHS Marktplatz',
      'UHS Marktplatz',
      'Fußstreife 1',
      'Pause',
    ]);
    expect(annas.schichten).toBe(3);
    expect(annas.minuten).toBe(9 * 60);
    expect(annas.zeilen[0].mit.map((p) => p.name)).toEqual(['Cora Clausen']);
    expect(annas.zeilen[3].mit).toEqual([]);
  });

  it('Helfer tragen Organisation und Telefon, Stamm und Ad-hoc nicht', () => {
    const z = zettel(ausEinsatzPlan(plan(STADTFEST()), ZEILEN));
    const cora = z.find((x) => x.person.name === 'Cora Clausen')!.person;
    expect(cora).toMatchObject({ organisation: 'JUH', telefon: '0151 123' });
    const ben = z.find((x) => x.person.name === 'Ben Berg')!.person;
    expect(ben).toMatchObject({ organisation: null, telefon: null, schluessel: 'einsatz:2' });
  });

  it('Ohne Modul Personal: keine Namen, keine Zettel, Besetzung als Zahl', () => {
    const p = ausEinsatzPlan(plan(STADTFEST(), false), ZEILEN);
    expect(p.personen).toBeNull();
    expect(zettel(p)).toEqual([]);
    const uhs = aushaenge(p).find((x) => x.posten.schluessel === 'uhs:9')!;
    expect(uhs.zeilen[0].personen).toEqual([]);
    expect(besetzungText(uhs.zeilen[0].schicht)).toBe('2 von 2 besetzt');
  });

  it('Ein Posten, den die Zeilen nicht kennen, bekommt trotzdem ein Blatt', () => {
    const b = [
      block({
        posten: { art: 'einheit', einheit_id: 99, bezeichnung: 'KTW 3', aufgeloest: true },
      }),
    ];
    expect(aushaenge(ausEinsatzPlan(plan(b), ZEILEN)).map((x) => x.posten.titel)).toEqual([
      'KTW 3',
    ]);
  });

  it('Mehrere Tage: Ende um Mitternacht zählt zum Vortag', () => {
    const tag = (ms: number) => new Date(ms).toISOString().slice(0, 10);
    const bisMitternacht = ausEinsatzPlan(
      plan([block({ von: '2026-08-15 20:00:00', bis: '2026-08-16 00:00:00' })]),
      ZEILEN,
    );
    expect(mehrereTage(bisMitternacht, tag)).toBe(false);
    const ueberNacht = ausEinsatzPlan(
      plan([block({ von: '2026-08-15 22:00:00', bis: '2026-08-16 02:00:00' })]),
      ZEILEN,
    );
    expect(mehrereTage(ueberNacht, tag)).toBe(true);
  });

  it('Soll- und Besetzungstexte', () => {
    expect(sollText(4, [{ label: 'Rettungssanitäter', anzahl: 1 }])).toBe(
      'Soll 4, davon 1 × Rettungssanitäter',
    );
    expect(sollText(2, [])).toBe('Soll 2');
    expect(sollText(null, [])).toBeNull();
  });
});
