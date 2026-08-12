import { it, expect } from 'vitest';
import { baueKraeftebild, filtereKraefte, rendereMeldebildMarkdown, verdichte, OHNE_ABSCHNITT_KEY } from './kraeftebild';
import type { Einheit, EinsatzPersonal, EinsatzFahrzeug, EinsatzMaterial, Einsatzabschnitt } from '../api/types';

const ab = (id: number, ueber: number | null = null, name = `A${id}`): Einsatzabschnitt =>
  ({ id, einsatz_id: 1, ueber_abschnitt_id: ueber, name, leiter_id: null, leiter_name: null,
     bemerkung: null, sortier: id, flaeche_geojson: null, tz_fachaufgabe: null, tz_organisation: null,
     sprechgruppe_tmo: null, sprechgruppe_dmo: null, kommunikationsmittel: null, erreichbarkeit: null, sprechgruppen: [] });
const eh = (id: number, abschnitt_id: number | null, ueber_einheit_id: number | null = null): Einheit =>
  ({ id, einsatz_id: 1, abschnitt_id, abschnitt_name: null, ueber_einheit_id, typ_id: null,
     typ_label: 'Gruppe', name: `E${id}`, fuehrer_id: null, fuehrer_name: null, bemerkung: null,
     sortier: id, soll: null, ist: { fuehrer: 0, unterfuehrer: 0, mannschaft: 0 },
     ist_kumuliert: { fuehrer: 0, unterfuehrer: 0, mannschaft: 0 },
     personal_mitglieder: [], fahrzeug_mitglieder: [], material_mitglieder: [],
     lat: null, lon: null, tz_fachaufgabe: null, tz_organisation: null, aktueller_br_id: null, sprechgruppen: [] });
const p = (id: number, einheit_id: number | null, pos: EinsatzPersonal['staerke_position'],
           kat: EinsatzPersonal['status_kategorie'] = 'gebunden'): EinsatzPersonal =>
  ({ id, einsatz_id: 1, personal_id: null, einheit_id, fahrzeug_id: null, ist_adhoc: false, name: `P${id}`,
     funktion: null, traegerorganisation: null, staerke_position: pos, status_id: null,
     status_label: null, status_kategorie: kat, status_farbe: null, disponiert_at: '', disponiert_von: null, bemerkung: null });
const fz = (id: number, einheit_id: number | null, kat: EinsatzFahrzeug['status_kategorie'] = 'verfuegbar',
            fms: number | null = 2): EinsatzFahrzeug =>
  ({ id, einsatz_id: 1, fahrzeug_id: null, einheit_id, ist_adhoc: false, funkrufname: `F${id}`,
     kennzeichen: null, fahrzeugtyp: 'LF', opta: null, traegerorganisation: null, status_id: null,
     status_label: `${fms}`, status_kategorie: kat, status_farbe: null, bemerkung: null,
     disponiert_at: '', disponiert_von: null, lat: null, lon: null, tz_fachaufgabe: null, tz_organisation: null,
     aktueller_br_id: null, soll_besatzung: null });

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
  const bild = baueKraeftebild([ab(1)], [eh(10, null)], [p(1, null, 'mannschaft')], [fz(9, null)], []);
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
  const fahrzeuge = [fz(1, null, 'verfuegbar'), fz(2, null, 'gebunden'), fz(3, null, 'nicht_verfuegbar')];
  const bild = baueKraeftebild([], [], [], fahrzeuge, []);
  expect(bild.verdichtung.fahrzeugStatus.verfuegbar).toBe(1);
  expect(bild.verdichtung.fahrzeugStatus.gebunden).toBe(1);
  expect(bild.verdichtung.fahrzeugStatus.nicht_verfuegbar).toBe(1);
});

it('Waisen-Abschnitt (Eltern nicht in Eingabe) wird zur Wurzel promotet', () => {
  // Filter auf Unter-Abschnitt 2 (ueber_abschnitt_id=1), aber Abschnitt 1 fehlt
  // in der Eingabe. Ohne Promotion bliebe der Baum leer, während der Kopf zählt.
  const bild = baueKraeftebild([ab(2, 1)], [eh(10, 2)], [p(1, 10, 'mannschaft')], [], []);
  expect(bild.verdichtung.anzahlPersonal).toBe(1);
  const a2 = bild.baum.find((z) => z.key === 'ab-2');
  expect(a2).toBeDefined();
  expect(a2!.staerke.gesamt).toBe(1);
});

const mat = (id: number, einheit_id: number | null, status: EinsatzMaterial['status'], menge = 1): EinsatzMaterial =>
  ({ id, einsatz_id: 1, material_id: null, einheit_id, uhs_id: null, ist_adhoc: false, bezeichnung: `M${id}`,
     kategorie: null, bestandsnummer: null, traegerorganisation: null, menge, status, bemerkung: null,
     disponiert_at: '', disponiert_von: null });

it('verdichtet Material nach Status', () => {
  const bild = baueKraeftebild([], [], [], [], [mat(1, null, 'einsatzbereit'), mat(2, null, 'defekt'), mat(3, null, 'einsatzbereit')]);
  expect(bild.verdichtung.materialStatus.einsatzbereit).toBe(2);
  expect(bild.verdichtung.materialStatus.defekt).toBe(1);
  expect(bild.verdichtung.anzahlMaterialPositionen).toBe(3);
});

it('filtert Personal nach Trägerorganisation und Summe zieht mit', () => {
  const personal = [
    { ...p(1, null, 'mannschaft'), traegerorganisation: 'THW' },
    { ...p(2, null, 'mannschaft'), traegerorganisation: 'FW' },
  ];
  const ge = filtereKraefte({ abschnitte: [], einheiten: [], personal, fahrzeuge: [], material: [] },
    { traeger: 'THW', abschnittId: null, kategorie: null, suche: '' });
  const bild = baueKraeftebild(ge.abschnitte, ge.einheiten, ge.personal, ge.fahrzeuge, ge.material);
  expect(bild.verdichtung.anzahlPersonal).toBe(1);
});

it('Status-Filter lässt Material unverändert (eigene Achse)', () => {
  const personal = [p(1, null, 'mannschaft', 'verfuegbar'), p(2, null, 'mannschaft', 'gebunden')];
  const material = [mat(1, null, 'einsatzbereit'), mat(2, null, 'defekt')];
  const ge = filtereKraefte({ abschnitte: [], einheiten: [], personal, fahrzeuge: [], material },
    { traeger: null, abschnittId: null, kategorie: 'verfuegbar', suche: '' });
  // Personal wird nach Kategorie gefiltert …
  expect(ge.personal).toHaveLength(1);
  // … Material bleibt vollständig erhalten (keine status_kategorie).
  expect(ge.material).toHaveLength(2);
});

it('Abschnitts-Filter grenzt Blätter ein und liefert nur den gewählten Abschnitt im Baum', () => {
  const abschnitte = [ab(1), ab(2)];
  const einheiten = [eh(10, 1), eh(20, 2)];
  const personal = [p(1, 10, 'mannschaft'), p(2, 20, 'mannschaft')];
  const ge = filtereKraefte({ abschnitte, einheiten, personal, fahrzeuge: [], material: [] },
    { traeger: null, abschnittId: 1, kategorie: null, suche: '' });
  expect(ge.abschnitte.map((a) => a.id)).toEqual([1]);
  expect(ge.einheiten.map((e) => e.id)).toEqual([10]);
  expect(ge.personal.map((x) => x.id)).toEqual([1]);
  const bild = baueKraeftebild(ge.abschnitte, ge.einheiten, ge.personal, ge.fahrzeuge, ge.material);
  expect(bild.baum.map((z) => z.key)).toEqual(['ab-1']);
});

it('rendert das Meldebild als Markdown mit Kopfzeile und Abschnitten', () => {
  // Die Fixture trägt ALLE DREI Mittelarten. Mit nur einer Person wäre die
  // „keine Bildzeichen"-Behauptung unten für zwei der drei Zweige gar nicht belegt —
  // sie liefe über Text, den der Renderer nie erzeugt hat.
  const bild = baueKraeftebild([ab(1)], [eh(10, 1)], [p(1, 10, 'fuehrer')], [fz(1, 10)], [mat(1, 10, 'einsatzbereit')]);
  const md = rendereMeldebildMarkdown(bild, 'Stand 12:00');
  expect(md).toContain('# Kräftemeldebild');
  expect(md).toContain('Stand 12:00');
  expect(md).toContain('Gesamtstärke');
  expect(md).toContain('A1');
  // Die Art des Mittels steht als KURZWORT in der Liste, nicht als Bildzeichen: der
  // Lagebericht wird gedruckt und in Textketten weitergereicht. Als Literale gepinnt und
  // nicht über die Konstante des Renderers — sonst prüfte der Test sie gegen sich selbst.
  expect(md).toContain('- Pers. P1');
  expect(md).toContain('- Fzg. F1');
  expect(md).toContain('- Mtl. M1');
  // Hier stand vorher je ein Emoji.
  expect(md).not.toMatch(/\p{Extended_Pictographic}/u);
});

it('Suche matcht über Name und Funkrufname', () => {
  const personal = [
    { ...p(1, null, 'mannschaft'), name: 'Müller' },
    { ...p(2, null, 'mannschaft'), name: 'Schmidt' },
  ];
  const fahrzeuge = [fz(1, null), fz(2, null)]; // funkrufname F1 / F2
  const nachName = filtereKraefte({ abschnitte: [], einheiten: [], personal, fahrzeuge, material: [] },
    { traeger: null, abschnittId: null, kategorie: null, suche: 'müll' });
  expect(nachName.personal.map((x) => x.name)).toEqual(['Müller']);
  expect(nachName.fahrzeuge).toHaveLength(0);
  const nachFunk = filtereKraefte({ abschnitte: [], einheiten: [], personal, fahrzeuge, material: [] },
    { traeger: null, abschnittId: null, kategorie: null, suche: 'f2' });
  expect(nachFunk.fahrzeuge.map((x) => x.funkrufname)).toEqual(['F2']);
  expect(nachFunk.personal).toHaveLength(0);
});

/**
 * Die BRÜCKE zwischen den zwei Zahlenwegen derselben Frage (LFH-330 · B2).
 *
 * Der Kennzahlenkopf der Kräfteübersicht liest `verdichtung`, gerechnet direkt aus den
 * Rohlisten. Die neue Ampelzeile in den Baumzeilen liest `personalVerteilung` /
 * `fahrzeugVerteilung`, kumuliert über `addKategorie` und `addVerteilung`. Zwei Wege, eine
 * Frage — und bei kaputter Kumulation laufen sie auseinander, ohne dass ein Test es merkt:
 * „Kopf zählt jede Kraft genau einmal" deckt den Kopf, nicht den Vergleich.
 *
 * Die Fixture ist absichtlich schief: verschachtelte Einheiten, eine Kraft OHNE Einheit
 * (landet im Sammelknoten) und drei verschiedene Kategorien. Eine flache Fixture mit einer
 * Kategorie wäre auch bei kaputter Rekursion grün.
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
  const bild = baueKraeftebild([ab(1)], [eh(10, 1), eh(20, 1, 10), eh(30, null)], personal, fahrzeuge, []);

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
  // Und die Verdichtung selbst ist nicht leer — sonst wäre 0 == 0 die ganze Aussage.
  expect(bild.verdichtung.personalStatus).toEqual({
    verfuegbar: 1, gebunden: 1, nicht_verfuegbar: 1, ohne: 1,
  });
  expect(bild.verdichtung.fahrzeugStatus).toEqual({
    verfuegbar: 2, gebunden: 1, nicht_verfuegbar: 0, ohne: 1,
  });
});

// ── verdichte() als eigenständige reine Funktion (LFH-338 · C3) ────────────────
//
// Dieselbe Rechnung wird dreimal gebraucht: gefiltert für die Kopfzahlen, UNGEFILTERT als
// Bezugswert daneben und in der Verdichtungszeile der vier Kräfte-Modulseiten. Solange sie
// im Rumpf von `baueKraeftebild` steckte, war der zweite und dritte Aufruf nur über einen
// vollen Baumaufbau zu haben — inklusive Abschnitten und Einheiten, die keiner der beiden
// braucht.

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

// ANKER, keine Zusicherung: seit der Auslösung RUFT `baueKraeftebild` die Funktion, der
// Vergleich kann also nicht mehr rot werden. Er steht für den Fall, dass jemand die Rechnung
// dort wieder von Hand einbaut — dann fällt eine Abweichung sofort auf, statt den Kopf zwei
// Wahrheiten zeigen zu lassen.
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
