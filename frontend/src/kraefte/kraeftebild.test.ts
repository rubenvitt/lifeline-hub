import { createElement } from 'react';
import { it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Markdown from '../components/Markdown';
import {
  baueKraeftebild,
  filtereKraefte,
  rendereMeldebildMarkdown,
  verdichte,
  OHNE_ABSCHNITT_KEY,
} from './kraeftebild';
import { personalBand } from './meldebildRaster';
import type {
  Einheit,
  EinsatzPersonal,
  EinsatzFahrzeug,
  EinsatzMaterial,
  Einsatzabschnitt,
} from '../api/types';

const ab = (id: number, ueber: number | null = null, name = `A${id}`): Einsatzabschnitt => ({
  id,
  einsatz_id: 1,
  ueber_abschnitt_id: ueber,
  name,
  leiter_id: null,
  leiter_name: null,
  bemerkung: null,
  sortier: id,
  flaeche_geojson: null,
  tz_fachaufgabe: null,
  tz_organisation: null,
  sprechgruppe_tmo: null,
  sprechgruppe_dmo: null,
  kommunikationsmittel: null,
  erreichbarkeit: null,
  sprechgruppen: [],
});
const eh = (
  id: number,
  abschnitt_id: number | null,
  ueber_einheit_id: number | null = null,
): Einheit => ({
  id,
  einsatz_id: 1,
  abschnitt_id,
  abschnitt_name: null,
  ueber_einheit_id,
  typ_id: null,
  typ_label: 'Gruppe',
  name: `E${id}`,
  fuehrer_id: null,
  fuehrer_name: null,
  bemerkung: null,
  sortier: id,
  soll: null,
  ist: { fuehrer: 0, unterfuehrer: 0, mannschaft: 0 },
  ist_kumuliert: { fuehrer: 0, unterfuehrer: 0, mannschaft: 0 },
  personal_mitglieder: [],
  fahrzeug_mitglieder: [],
  material_mitglieder: [],
  lat: null,
  lon: null,
  tz_fachaufgabe: null,
  tz_organisation: null,
  aktueller_br_id: null,
  sprechgruppen: [],
  status: { quelle: 'ohne', verteilung: [] },
});
const p = (
  id: number,
  einheit_id: number | null,
  pos: EinsatzPersonal['staerke_position'],
  kat: EinsatzPersonal['status_kategorie'] = 'gebunden',
): EinsatzPersonal => ({
  id,
  einsatz_id: 1,
  personal_id: null,
  einheit_id,
  fahrzeug_id: null,
  ist_adhoc: false,
  ist_demo: false,
  name: `P${id}`,
  funktion: null,
  traegerorganisation: null,
  staerke_position: pos,
  status_id: null,
  status_label: null,
  status_kategorie: kat,
  status_farbe: null,
  disponiert_at: '',
  disponiert_von: null,
  bemerkung: null,
});
const fz = (
  id: number,
  einheit_id: number | null,
  kat: EinsatzFahrzeug['status_kategorie'] = 'verfuegbar',
  fms: number | null = 2,
): EinsatzFahrzeug => ({
  id,
  einsatz_id: 1,
  fahrzeug_id: null,
  einheit_id,
  ist_adhoc: false,
  ist_demo: false,
  funkrufname: `F${id}`,
  kennzeichen: null,
  fahrzeugtyp: 'LF',
  opta: null,
  traegerorganisation: null,
  status_id: null,
  status_label: `${fms}`,
  status_kategorie: kat,
  status_farbe: null,
  bemerkung: null,
  disponiert_at: '',
  disponiert_von: null,
  lat: null,
  lon: null,
  tz_fachaufgabe: null,
  tz_organisation: null,
  aktueller_br_id: null,
  soll_besatzung: null,
});

it('Invariante: Kopf zählt jede Kraft genau einmal', () => {
  const personal = [p(1, 10, 'fuehrer'), p(2, 10, 'mannschaft'), p(3, null, 'mannschaft')];
  const fahrzeuge = [fz(1, 10), fz(2, null)];
  const material: EinsatzMaterial[] = [];
  const bild = baueKraeftebild([ab(1)], [eh(10, 1)], personal, fahrzeuge, material);
  expect(bild.verdichtung.anzahlPersonal).toBe(3);
  expect(bild.verdichtung.anzahlFahrzeuge).toBe(2);
  expect(bild.verdichtung.staerke.gesamt).toBe(3);
  expect(bild.verdichtung.staerke.fuehrer).toBe(1);
  expect(bild.verdichtung.staerke.mannschaft).toBe(2);
});

it('verschachtelte Einheiten: keine Doppelzählung', () => {
  const personal = [p(1, 10, 'fuehrer'), p(2, 20, 'mannschaft'), p(3, 20, 'mannschaft')];
  const bild = baueKraeftebild([ab(1)], [eh(10, 1), eh(20, 1, 10)], personal, [], []);
  expect(bild.verdichtung.staerke.gesamt).toBe(3);
  const a1 = bild.baum.find((z) => z.key === 'ab-1')!;
  expect(a1.staerke.gesamt).toBe(3);
  const e10 = a1.children!.find((z) => z.key === 'eh-10')!;
  expect(e10.staerke.gesamt).toBe(3);
});

it('verschachtelte Abschnitte rollen hoch', () => {
  const bild = baueKraeftebild([ab(1), ab(2, 1)], [eh(10, 2)], [p(1, 10, 'mannschaft')], [], []);
  // Kind-Abschnitt mit vorhandenem Eltern erscheint NUR unter dem Eltern, nicht als zweite Wurzel.
  expect(bild.baum.map((z) => z.key)).toEqual(['ab-1']);
  const a1 = bild.baum.find((z) => z.key === 'ab-1')!;
  expect(a1.staerke.gesamt).toBe(1);
  expect(a1.children!.map((z) => z.key)).toContain('ab-2');
});

it('Catch-all: Kräfte ohne Zuordnung erscheinen und zählen', () => {
  const bild = baueKraeftebild(
    [ab(1)],
    [eh(10, null)],
    [p(1, null, 'mannschaft')],
    [fz(9, null)],
    [],
  );
  expect(bild.verdichtung.anzahlPersonal).toBe(1);
  expect(bild.verdichtung.anzahlFahrzeuge).toBe(1);
  const ohne = bild.baum.find((z) => z.key === OHNE_ABSCHNITT_KEY);
  expect(ohne).toBeDefined();
  expect(ohne!.staerke.gesamt).toBe(1);
});

it('leerer Einsatz: alles 0, kein Crash', () => {
  const bild = baueKraeftebild([], [], [], [], []);
  expect(bild.verdichtung.staerke.gesamt).toBe(0);
  expect(bild.baum).toEqual([]);
});

it('verdichtet Fahrzeug-Status getrennt', () => {
  const fahrzeuge = [
    fz(1, null, 'verfuegbar'),
    fz(2, null, 'gebunden'),
    fz(3, null, 'nicht_verfuegbar'),
  ];
  const bild = baueKraeftebild([], [], [], fahrzeuge, []);
  expect(bild.verdichtung.fahrzeugStatus.verfuegbar).toBe(1);
  expect(bild.verdichtung.fahrzeugStatus.gebunden).toBe(1);
  expect(bild.verdichtung.fahrzeugStatus.nicht_verfuegbar).toBe(1);
});

it('Waisen-Abschnitt (Eltern nicht in Eingabe) wird zur Wurzel promotet', () => {
  // Filter auf Unter-Abschnitt 2, Abschnitt 1 fehlt in der Eingabe. Ohne Promotion bliebe der
  // Baum leer, während der Kopf zählt.
  const bild = baueKraeftebild([ab(2, 1)], [eh(10, 2)], [p(1, 10, 'mannschaft')], [], []);
  expect(bild.verdichtung.anzahlPersonal).toBe(1);
  const a2 = bild.baum.find((z) => z.key === 'ab-2');
  expect(a2).toBeDefined();
  expect(a2!.staerke.gesamt).toBe(1);
});

const mat = (
  id: number,
  einheit_id: number | null,
  status: EinsatzMaterial['status'],
  menge = 1,
): EinsatzMaterial => ({
  id,
  einsatz_id: 1,
  material_id: null,
  einheit_id,
  uhs_id: null,
  ist_adhoc: false,
  ist_demo: false,
  bezeichnung: `M${id}`,
  kategorie: null,
  bestandsnummer: null,
  traegerorganisation: null,
  menge,
  status,
  bemerkung: null,
  disponiert_at: '',
  disponiert_von: null,
});

it('verdichtet Material nach Status', () => {
  const bild = baueKraeftebild(
    [],
    [],
    [],
    [],
    [mat(1, null, 'einsatzbereit'), mat(2, null, 'defekt'), mat(3, null, 'einsatzbereit')],
  );
  expect(bild.verdichtung.materialStatus.einsatzbereit).toBe(2);
  expect(bild.verdichtung.materialStatus.defekt).toBe(1);
  expect(bild.verdichtung.anzahlMaterialPositionen).toBe(3);
});

it('filtert Personal nach Trägerorganisation und Summe zieht mit', () => {
  const personal = [
    { ...p(1, null, 'mannschaft'), traegerorganisation: 'THW' },
    { ...p(2, null, 'mannschaft'), traegerorganisation: 'FW' },
  ];
  const ge = filtereKraefte(
    { abschnitte: [], einheiten: [], personal, fahrzeuge: [], material: [] },
    { traeger: 'THW', abschnittId: null, kategorie: null, suche: '' },
  );
  const bild = baueKraeftebild(ge.abschnitte, ge.einheiten, ge.personal, ge.fahrzeuge, ge.material);
  expect(bild.verdichtung.anzahlPersonal).toBe(1);
});

it('Status-Filter lässt Material unverändert (eigene Achse)', () => {
  const personal = [p(1, null, 'mannschaft', 'verfuegbar'), p(2, null, 'mannschaft', 'gebunden')];
  const material = [mat(1, null, 'einsatzbereit'), mat(2, null, 'defekt')];
  const ge = filtereKraefte(
    { abschnitte: [], einheiten: [], personal, fahrzeuge: [], material },
    { traeger: null, abschnittId: null, kategorie: 'verfuegbar', suche: '' },
  );
  // Personal wird nach Kategorie gefiltert …
  expect(ge.personal).toHaveLength(1);
  // … Material bleibt vollständig erhalten (keine status_kategorie).
  expect(ge.material).toHaveLength(2);
});

it('Abschnitts-Filter grenzt Blätter ein und liefert nur den gewählten Abschnitt im Baum', () => {
  const abschnitte = [ab(1), ab(2)];
  const einheiten = [eh(10, 1), eh(20, 2)];
  const personal = [p(1, 10, 'mannschaft'), p(2, 20, 'mannschaft')];
  const ge = filtereKraefte(
    { abschnitte, einheiten, personal, fahrzeuge: [], material: [] },
    { traeger: null, abschnittId: 1, kategorie: null, suche: '' },
  );
  expect(ge.abschnitte.map((a) => a.id)).toEqual([1]);
  expect(ge.einheiten.map((e) => e.id)).toEqual([10]);
  expect(ge.personal.map((x) => x.id)).toEqual([1]);
  const bild = baueKraeftebild(ge.abschnitte, ge.einheiten, ge.personal, ge.fahrzeuge, ge.material);
  expect(bild.baum.map((z) => z.key)).toEqual(['ab-1']);
});

it('Abschnitts-Filter behält eine Untereinheit ohne eigenen Abschnitt unter ihrem Zug (D11)', () => {
  const abschnitte = [ab(1), ab(2)];
  // Gr 11 ohne eigenen Abschnitt unter Zug 10 (Abschnitt 1); Gr 12 steht selbst in 2, zählt aber
  // beim Abschnitt ihrer obersten Einheit (Spec `lage-verdichtung`).
  const einheiten = [eh(10, 1), eh(11, null, 10), eh(12, 2, 10), eh(20, 2)];
  const personal = [p(1, 11, 'mannschaft'), p(2, 12, 'mannschaft'), p(3, 20, 'mannschaft')];
  const nach = (abschnittId: number) =>
    filtereKraefte(
      { abschnitte, einheiten, personal, fahrzeuge: [], material: [] },
      { traeger: null, abschnittId, kategorie: null, suche: '' },
    );
  expect(nach(1).einheiten.map((e) => e.id)).toEqual([10, 11, 12]);
  expect(nach(1).personal.map((x) => x.id)).toEqual([1, 2]);
  expect(nach(2).einheiten.map((e) => e.id)).toEqual([20]);
  expect(nach(2).personal.map((x) => x.id)).toEqual([3]);
});

it('rendert das Meldebild als Markdown mit Kopfzeile und Abschnitten', () => {
  // Die Fixture trägt ALLE DREI Mittelarten, sonst wäre „keine Bildzeichen" für zwei Zweige
  // nicht belegt.
  const bild = baueKraeftebild(
    [ab(1)],
    [eh(10, 1)],
    [p(1, 10, 'fuehrer')],
    [fz(1, 10)],
    [mat(1, 10, 'einsatzbereit')],
  );
  const md = rendereMeldebildMarkdown(bild, 'Stand 12:00');
  expect(md).toContain('# Kräftemeldebild');
  expect(md).toContain('Stand 12:00');
  expect(md).toContain('Gesamtstärke');
  expect(md).toContain('A1');
  // Die Art des Mittels als KURZWORT, als Literale gepinnt — nicht über die Konstante des
  // Renderers.
  expect(md).toContain('- Pers. P1');
  expect(md).toContain('- Fzg. F1');
  expect(md).toContain('- Mtl. M1');
  expect(md).not.toMatch(/\p{Extended_Pictographic}/u);
});

it('der Lagebericht-Text folgt dem Kräftebaum: Fahrzeug mit Besatzung, „Ohne Fahrzeug“, Material verdichtet (D10)', () => {
  // Zug 10 mit Fahrzeug F1 (Soll 1/1/7), Führer P1 darauf, P2 ohne Fahrzeug, defektes Material;
  // Gruppe 20 darunter mit P3 auf F1 — sie „fährt auf“ und zählt in der Besatzung Ist mit.
  const zug = { ...eh(10, 1), typ_label: 'Zug', fuehrer_id: 1 };
  const fahrzeug = { ...fz(1, 10), soll_besatzung: { fuehrer: 1, unterfuehrer: 1, mannschaft: 7 } };
  const bild = baueKraeftebild(
    [ab(1)],
    [zug, eh(20, null, 10)],
    [
      { ...p(1, 10, 'fuehrer'), fahrzeug_id: 1 },
      p(2, 10, 'mannschaft'),
      { ...p(3, 20, 'mannschaft'), fahrzeug_id: 1 },
    ],
    [fahrzeug],
    [mat(1, 10, 'defekt'), mat(2, 10, 'einsatzbereit')],
  );
  const md = rendereMeldebildMarkdown(bild, 'Stand 12:00');
  const teil = md.slice(
    md.indexOf('- **E10**'),
    md.lastIndexOf('fährt auf F1') + 'fährt auf F1'.length,
  );
  expect(teil.split('\n')).toEqual([
    '- **E10** (Zug) — Stärke: 1/0/2//3',
    '  - Fzg. F1 (LF) [2] — Besatzung Ist 1/0/1//2 · Soll 1/1/7//9, davon 1 aus E20',
    '    - Pers. P1 (EF) [gebunden]',
    '  - Ohne Fahrzeug: 1 Kraft',
    '    - Pers. P2 [gebunden]',
    '  - Material: 2 Posten, 1 Ausfall',
    '    - Mtl. M1 ×1 [defekt]',
    '    - Mtl. M2 ×1 [einsatzbereit]',
    '  - **E20** (Gruppe) — Stärke: 0/0/1//1',
    '    - Pers. P3 [gebunden] — fährt auf F1',
  ]);
});

it('Kennzahlen des Lagebilds stehen in der Anzeige je in eigenem Block (LFH-1153)', () => {
  // Markdown ohne harte Umbrüche: Zeilen ohne Leerzeile dazwischen liefen zu EINEM Absatz zusammen
  // — im Lagebericht stand „Gesamtstärke … Fahrzeuge … Material …“ in einer Zeile.
  const bild = baueKraeftebild(
    [ab(1)],
    [eh(10, 1)],
    [p(1, 10, 'fuehrer')],
    [fz(1, 10)],
    [mat(1, 10, 'einsatzbereit')],
  );
  render(
    createElement(Markdown, {
      unterEbene: 2,
      children: rendereMeldebildMarkdown(bild, 'Stand 12:00'),
    }),
  );
  for (const [kennzahl, nachbar] of [
    ['Gesamtstärke', 'Fahrzeuge:'],
    ['Fahrzeuge:', 'Material'],
  ] as const) {
    const block = screen.getByText(kennzahl, { exact: false }).closest('p, li');
    expect(block).not.toBeNull();
    expect(block).not.toHaveTextContent(nachbar);
  }
  // Die Aufschlüsselung des Materials bleibt bei seiner Kennzahl.
  expect(screen.getByText(/Material \(Positionen\)/).closest('p, li')).toHaveTextContent(
    'einsatzbereit: 1',
  );
});

it('Suche matcht über Name und Funkrufname', () => {
  const personal = [
    { ...p(1, null, 'mannschaft'), name: 'Müller' },
    { ...p(2, null, 'mannschaft'), name: 'Schmidt' },
  ];
  const fahrzeuge = [fz(1, null), fz(2, null)]; // funkrufname F1 / F2
  const nachName = filtereKraefte(
    { abschnitte: [], einheiten: [], personal, fahrzeuge, material: [] },
    { traeger: null, abschnittId: null, kategorie: null, suche: 'müll' },
  );
  expect(nachName.personal.map((x) => x.name)).toEqual(['Müller']);
  expect(nachName.fahrzeuge).toHaveLength(0);
  const nachFunk = filtereKraefte(
    { abschnitte: [], einheiten: [], personal, fahrzeuge, material: [] },
    { traeger: null, abschnittId: null, kategorie: null, suche: 'f2' },
  );
  expect(nachFunk.fahrzeuge.map((x) => x.funkrufname)).toEqual(['F2']);
  expect(nachFunk.personal).toHaveLength(0);
});

/**
 * Die BRÜCKE zwischen zwei Zahlenwegen derselben Frage: der Kennzahlenkopf liest
 * `verdichtung` (aus den Rohlisten), die Ampelzeile im Baum die kumulierten Verteilungen. Bei
 * kaputter Kumulation liefen sie auseinander. Die Fixture ist absichtlich schief (verschachtelte
 * Einheiten, eine Kraft ohne Einheit, drei Kategorien).
 */
it('Brücke: die Wurzelzeilen summieren sich auf die Verdichtung — beide Achsen', () => {
  const personal = [
    p(1, 10, 'fuehrer', 'verfuegbar'),
    p(2, 20, 'mannschaft', 'gebunden'),
    p(3, null, 'mannschaft', null),
    p(4, 30, 'unterfuehrer', 'nicht_verfuegbar'),
  ];
  const fahrzeuge = [
    fz(1, 10, 'verfuegbar'),
    fz(2, 20, 'gebunden'),
    fz(3, null, null),
    fz(4, 30, 'verfuegbar'),
  ];
  // Abschnitt 1 mit Einheit 10 und darunter 20; Einheit 30 hängt an KEINEM Abschnitt.
  const bild = baueKraeftebild(
    [ab(1)],
    [eh(10, 1), eh(20, 1, 10), eh(30, null)],
    personal,
    fahrzeuge,
    [],
  );

  const summe = (feld: 'personalVerteilung' | 'fahrzeugVerteilung') =>
    bild.baum.reduce(
      (acc, z) => {
        const v = z[feld];
        if (!v) return acc;
        return {
          verfuegbar: acc.verfuegbar + v.verfuegbar,
          gebunden: acc.gebunden + v.gebunden,
          nicht_verfuegbar: acc.nicht_verfuegbar + v.nicht_verfuegbar,
          ohne: acc.ohne + v.ohne,
        };
      },
      { verfuegbar: 0, gebunden: 0, nicht_verfuegbar: 0, ohne: 0 },
    );

  expect(summe('personalVerteilung')).toEqual(bild.verdichtung.personalStatus);
  expect(summe('fahrzeugVerteilung')).toEqual(bild.verdichtung.fahrzeugStatus);
  // Die Verdichtung selbst ist nicht leer — sonst wäre 0 == 0 die ganze Aussage.
  expect(bild.verdichtung.personalStatus).toEqual({
    verfuegbar: 1,
    gebunden: 1,
    nicht_verfuegbar: 1,
    ohne: 1,
  });
  expect(bild.verdichtung.fahrzeugStatus).toEqual({
    verfuegbar: 2,
    gebunden: 1,
    nicht_verfuegbar: 0,
    ohne: 1,
  });
});

// `verdichte()` als eigenständige reine Funktion: gefiltert für die Kopfzahlen, ungefiltert als
// Bezugswert und in der Verdichtungszeile der Kräfte-Modulseiten.

it('verdichte summiert Stärke, Status und Mengen über die drei Rohlisten', () => {
  const v = verdichte(
    [p(1, null, 'fuehrer'), p(2, null, 'mannschaft'), p(3, null, 'mannschaft', 'verfuegbar')],
    [fz(1, null, 'verfuegbar'), fz(2, null, 'nicht_verfuegbar')],
    [mat(1, null, 'einsatzbereit'), mat(2, null, 'defekt'), mat(3, null, 'defekt')],
  );

  expect(v.staerke).toEqual({ fuehrer: 1, unterfuehrer: 0, mannschaft: 2, gesamt: 3 });
  expect(v.personalStatus).toEqual({ verfuegbar: 1, gebunden: 2, nicht_verfuegbar: 0, ohne: 0 });
  expect(v.fahrzeugStatus).toEqual({ verfuegbar: 1, gebunden: 0, nicht_verfuegbar: 1, ohne: 0 });
  expect(v.materialStatus.einsatzbereit).toBe(1);
  expect(v.materialStatus.defekt).toBe(2);
  expect(v.anzahlPersonal).toBe(3);
  expect(v.anzahlFahrzeuge).toBe(2);
  expect(v.anzahlMaterialPositionen).toBe(3);
});

it('verdichte liefert auf leeren Listen Nullen statt undefined', () => {
  const v = verdichte([], [], []);
  expect(v.staerke.gesamt).toBe(0);
  expect(v.anzahlPersonal).toBe(0);
  expect(v.materialStatus.einsatzbereit).toBe(0);
  expect(v.fahrzeugStatus.ohne).toBe(0);
});

// ANKER: `baueKraeftebild` ruft `verdichte`, der Vergleich kann heute nicht rot werden. Er fängt
// eine künftige Handrechnung dort ab.
it('verdichte stimmt mit der Verdichtung aus baueKraeftebild überein', () => {
  const personal = [p(1, 10, 'fuehrer'), p(2, 10, 'mannschaft'), p(3, null, 'mannschaft')];
  const fahrzeuge = [fz(1, 10), fz(2, null, 'gebunden')];
  const material = [mat(1, 10, 'im_einsatz')];
  const bild = baueKraeftebild([ab(1)], [eh(10, 1)], personal, fahrzeuge, material);
  const v = verdichte(personal, fahrzeuge, material);

  expect(v.staerke).toEqual(bild.verdichtung.staerke);
  expect(v.personalStatus).toEqual(bild.verdichtung.personalStatus);
  expect(v.fahrzeugStatus).toEqual(bild.verdichtung.fahrzeugStatus);
  expect(v.materialStatus).toEqual(bild.verdichtung.materialStatus);
  expect(v.anzahlMaterialPositionen).toBe(bild.verdichtung.anzahlMaterialPositionen);
});

it('eine Waise und ein Zyklus stehen in der Kräftegliederung und zählen wie die Gesamtstärke', () => {
  // E30 nennt eine Obereinheit, die nicht in der Liste steht (Waise); E40 und E41 unterstellen
  // sich gegenseitig (Zyklus). Beide Fälle verlor der frühere eigene Baum, die Gesamtstärke
  // zählte die Kräfte trotzdem — der Kern (`einheitenBaum`) verliert keine Einheit.
  const bild = baueKraeftebild(
    [ab(1)],
    [eh(10, 1), eh(30, null, 99), eh(40, null, 41), eh(41, null, 40)],
    [p(1, 10, 'fuehrer'), p(5, 30, 'mannschaft'), p(6, 40, 'mannschaft'), p(7, 41, 'mannschaft')],
    [],
    [],
  );
  const gliederung = bild.baum.reduce((s, z) => s + (z.staerke?.gesamt ?? 0), 0);
  expect(bild.verdichtung.staerke.gesamt).toBe(4);
  expect(gliederung).toBe(bild.verdichtung.staerke.gesamt);
  const md = rendereMeldebildMarkdown(bild, 'Stand 12:00');
  for (const name of ['E30', 'E40', 'E41', 'P5', 'P6', 'P7']) expect(md).toContain(name);
});

// ── Nur aktive Kräfte (LLH-1079) ─────────────────────────────────────────────

const entlassen = (x: EinsatzPersonal): EinsatzPersonal => ({
  ...x,
  beendet_at: '2026-10-13 14:00:00',
  beendet_als: 'entlassen',
});
const aufgeloest = (x: Einheit): Einheit => ({ ...x, aufgeloest_at: '2026-10-13 15:00:00' });
const ohneFilter = { traeger: null, abschnittId: null, kategorie: null, suche: '' };

it('filtereKraefte lässt Entlassene und aufgelöste Einheiten aus: Meldebild und Statusband zählen zehn', () => {
  // Spec `kraefte-entlassung`, „Stärke ohne Entlassene“: zwölf Personen, zwei entlassen.
  const personal = Array.from({ length: 12 }, (_, i) =>
    i < 2 ? entlassen(p(i + 1, 10, 'mannschaft')) : p(i + 1, 10, 'mannschaft'),
  );
  const ge = filtereKraefte(
    {
      abschnitte: [ab(1)],
      einheiten: [eh(10, 1), aufgeloest(eh(20, 1))],
      personal,
      fahrzeuge: [],
      material: [],
    },
    ohneFilter,
  );
  expect(ge.einheiten.map((e) => e.id)).toEqual([10]);
  expect(ge.personal).toHaveLength(10);
  expect(personalBand(ge.personal).reduce((s, z) => s + z.wert, 0)).toBe(10);
  const bild = baueKraeftebild(ge.abschnitte, ge.einheiten, ge.personal, [], []);
  expect(bild.verdichtung.staerke.gesamt).toBe(10);
  expect(bild.baum[0].staerke.gesamt).toBe(10);
});

it('eine Untereinheit einer aufgelösten Über-Einheit bleibt sichtbar und zählt bei ihrem eigenen Abschnitt', () => {
  // Gr X (11) unter Zug 10 (Abschnitt 1) ist aufgelöst; Trupp 12 zeigt noch auf sie und steht
  // selbst in Abschnitt 2. Ohne die aufgelöste Über-Einheit ist der Trupp eine Waise und damit
  // seine eigene oberste Einheit (D11).
  const abschnitte = [ab(1), ab(2)];
  const einheiten = [eh(10, 1), aufgeloest(eh(11, null, 10)), eh(12, 2, 11)];
  const personal = [p(1, 10, 'fuehrer'), p(2, 12, 'mannschaft')];
  const roh = { abschnitte, einheiten, personal, fahrzeuge: [], material: [] };

  const alle = filtereKraefte(roh, ohneFilter);
  const bild = baueKraeftebild(alle.abschnitte, alle.einheiten, alle.personal, [], []);
  const md = rendereMeldebildMarkdown(bild, 'Stand');
  expect(md).toContain('E12');
  expect(md).not.toContain('E11');
  expect(bild.baum.map((z) => z.key)).toEqual(['ab-1', 'ab-2']);
  expect(bild.baum.reduce((s, z) => s + z.staerke.gesamt, 0)).toBe(2);

  const nach = (abschnittId: number) => filtereKraefte(roh, { ...ohneFilter, abschnittId });
  expect(nach(2).einheiten.map((e) => e.id)).toEqual([12]);
  expect(nach(2).personal.map((x) => x.id)).toEqual([2]);
  expect(nach(1).einheiten.map((e) => e.id)).toEqual([10]);
  expect(nach(1).personal.map((x) => x.id)).toEqual([1]);
});
