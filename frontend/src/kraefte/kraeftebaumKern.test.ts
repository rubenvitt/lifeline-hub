import { describe, expect, it } from 'vitest';
import {
  abschnittDerObersten,
  besatzungsStaerke,
  besatzungsUrteilVon,
  brauchtOhneFahrzeugKnoten,
  einheitenBaum,
  istMaterialAusfall,
  kraeftebaum,
  kumuliere,
  materialAusfall,
  mittelDerEinheit,
  schluesselBisStufe,
  stufeVon,
  type EinheitKnoten,
  type KraeftebaumKnoten,
  type StufenZeile,
} from './kraeftebaumKern';
import { verdichte, type StaerkeSumme } from './kraeftebild';
import { staerkeText } from '../anzeige/staerke';
import type {
  Einheit,
  EinsatzFahrzeug,
  EinsatzMaterial,
  EinsatzPersonal,
  Einsatzabschnitt,
} from '../api/types';

// ── Fixtures (nur die gelesenen Felder zählen) ───────────────────────────────

const ab = (id: number, ueber: number | null = null) =>
  ({
    id,
    einsatz_id: 1,
    ueber_abschnitt_id: ueber,
    name: `A${id}`,
    sortier: id,
  }) as Einsatzabschnitt;

const eh = (
  id: number,
  abschnitt_id: number | null,
  ueber_einheit_id: number | null = null,
  extra: Partial<Einheit> = {},
) =>
  ({
    id,
    einsatz_id: 1,
    abschnitt_id,
    ueber_einheit_id,
    name: `E${id}`,
    fuehrer_id: null,
    ...extra,
  }) as unknown as Einheit;

const p = (
  id: number,
  einheit_id: number | null,
  pos: EinsatzPersonal['staerke_position'] = 'mannschaft',
  fahrzeug_id: number | null = null,
  name = `P${id}`,
) =>
  ({
    id,
    einsatz_id: 1,
    einheit_id,
    fahrzeug_id,
    name,
    staerke_position: pos,
    status_kategorie: 'gebunden',
  }) as EinsatzPersonal;

const fz = (
  id: number,
  einheit_id: number | null,
  funkrufname = `F${id}`,
  soll: EinsatzFahrzeug['soll_besatzung'] = null,
) => ({ id, einsatz_id: 1, einheit_id, funkrufname, soll_besatzung: soll }) as EinsatzFahrzeug;

const mt = (id: number, einheit_id: number | null, status: EinsatzMaterial['status']) =>
  ({ id, einsatz_id: 1, einheit_id, bezeichnung: `M${id}`, menge: 1, status }) as EinsatzMaterial;

const ids = (knoten: readonly EinheitKnoten[]): unknown[] =>
  knoten.map((k) => (k.kinder.length > 0 ? [k.einheit.id, ids(k.kinder)] : k.einheit.id));

// ── 1.1 Einheit-Hierarchie ───────────────────────────────────────────────────

describe('einheitenBaum', () => {
  it('hängt Untereinheiten als Kinder unter ihre Einheit, nicht als eigene Wurzeln', () => {
    const baum = einheitenBaum([eh(1, 10), eh(2, null, 1), eh(3, null, 1)], [ab(10)]);
    expect(baum.map((k) => k.einheit.id)).toEqual([1]);
    expect(baum[0].kinder.map((k) => k.einheit.id)).toEqual([2, 3]);
  });

  it('ordnet die Wurzeln nach Abschnittsrang (Eltern vor Kindern), dann nach Eingabefolge', () => {
    const baum = einheitenBaum(
      [eh(3, null), eh(1, 11), eh(2, 20), eh(4, null, 2), eh(5, 20)],
      [ab(20), ab(10), ab(11, 20)],
    );
    // Rang: 20 → 11 (Kind von 20) → 10; ohne Abschnitt ans Ende.
    expect(baum.map((k) => k.einheit.id)).toEqual([2, 5, 1, 3]);
    expect(baum[0].kinder.map((k) => k.einheit.id)).toEqual([4]);
  });

  it('ordnet auch Geschwister nach Abschnittsrang', () => {
    const baum = einheitenBaum([eh(1, 10), eh(2, 11, 1), eh(3, 10, 1)], [ab(10), ab(11)]);
    expect(baum[0].kinder.map((k) => k.einheit.id)).toEqual([3, 2]);
  });

  it('der Abschnitt einer Einheit ist der eigene, sonst der geerbte', () => {
    const baum = einheitenBaum([eh(1, 10), eh(2, null, 1), eh(3, 11, 1)], [ab(10), ab(11)]);
    expect(baum[0].abschnittId).toBe(10);
    expect(baum[0].kinder.map((k) => [k.einheit.id, k.abschnittId])).toEqual([
      [2, 10],
      [3, 11],
    ]);
  });

  it('Waise: eine Einheit, deren Obereinheit fehlt, wird Wurzel', () => {
    const baum = einheitenBaum([eh(2, null, 99)], []);
    expect(baum.map((k) => k.einheit.id)).toEqual([2]);
  });

  it('Zyklus: keine Einheit verschwindet, keine steht doppelt', () => {
    const baum = einheitenBaum([eh(1, null, 2), eh(2, null, 1), eh(3, null)], []);
    const flach: number[] = [];
    const sammle = (k: readonly EinheitKnoten[]) =>
      k.forEach((x) => {
        flach.push(x.einheit.id);
        sammle(x.kinder);
      });
    sammle(baum);
    expect(flach.sort()).toEqual([1, 2, 3]);
  });
});

describe('abschnittDerObersten', () => {
  it('eine Untereinheit zählt beim Abschnitt ihrer obersten Einheit', () => {
    const m = abschnittDerObersten([eh(1, 10), eh(2, null, 1), eh(3, 11, 1), eh(4, 12)]);
    expect([...m]).toEqual([
      [1, 10],
      [2, 10],
      [3, 10],
      [4, 12],
    ]);
  });

  it('fehlt die Obereinheit, gilt der eigene Abschnitt; ein Zyklus hängt nicht', () => {
    const m = abschnittDerObersten([eh(2, 11, 99), eh(5, 13, 6), eh(6, 14, 5)]);
    expect(m.get(2)).toBe(11);
    expect([13, 14]).toContain(m.get(5));
  });
});

// ── 1.2 Mittel der Einheit ───────────────────────────────────────────────────

describe('mittelDerEinheit', () => {
  it('Besatzung unter dem Fahrzeug, wer kein Fahrzeug hat, unter „Ohne Fahrzeug“', () => {
    const m = mittelDerEinheit(1, {
      einheiten: [eh(1, null)],
      personal: [p(1, 1, 'mannschaft', 30), p(2, 1, 'fuehrer', 30), p(3, 1)],
      fahrzeuge: [fz(30, 1, 'Florian 1-44-1')],
      material: [],
    });
    expect(m.fahrzeuge).toHaveLength(1);
    expect(m.fahrzeuge[0].besatzung.map((x) => x.person.id)).toEqual([2, 1]);
    expect(m.ohneFahrzeug.map((x) => x.person.id)).toEqual([3]);
    expect(brauchtOhneFahrzeugKnoten(m)).toBe(true);
  });

  it('ohne Fahrzeug in der Einheit braucht es keinen Knoten „Ohne Fahrzeug“', () => {
    const m = mittelDerEinheit(1, {
      einheiten: [eh(1, null)],
      personal: [p(1, 1)],
      fahrzeuge: [],
      material: [],
    });
    expect(m.ohneFahrzeug.map((x) => x.person.id)).toEqual([1]);
    expect(brauchtOhneFahrzeugKnoten(m)).toBe(false);
  });

  it('Person auf fremdem Fahrzeug bleibt bei ihrer Einheit und „fährt auf“; das Fahrzeug zählt sie', () => {
    const roh = {
      einheiten: [eh(1, null, null, { name: 'Gr 1' }), eh(2, null, null, { name: 'Gr 2' })],
      personal: [p(1, 1, 'mannschaft', 40), p(2, 2, 'fuehrer', 40)],
      fahrzeuge: [fz(40, 2, 'Florian 2')],
      material: [],
    };
    const a = mittelDerEinheit(1, roh);
    expect(a.fahrzeuge).toEqual([]);
    expect(a.ohneFahrzeug).toEqual([
      expect.objectContaining({ faehrtAuf: 'Florian 2', person: roh.personal[0] }),
    ]);
    const b = mittelDerEinheit(2, roh);
    expect(b.fahrzeuge[0].besatzung.map((x) => x.person.id)).toEqual([2]);
    expect(b.fahrzeuge[0].ist).toEqual({ fuehrer: 1, unterfuehrer: 0, mannschaft: 1 });
    expect(b.fahrzeuge[0].fremd).toEqual([{ einheit: 'Gr 1', anzahl: 1 }]);
  });

  it('ist das Fahrzeug weggefiltert, nennt „fährt auf“ den Namen aus der ungefilterten Liste', () => {
    const alle = [fz(30, 1, 'Florian 1')];
    const m = mittelDerEinheit(
      1,
      {
        einheiten: [eh(1, null)],
        personal: [p(1, 1, 'mannschaft', 30)],
        fahrzeuge: [],
        material: [],
      },
      { fahrzeuge: alle },
    );
    expect(m.ohneFahrzeug[0].faehrtAuf).toBe('Florian 1');
  });

  it('Besatzung Ist zählt auch Personal, das der Filter ausblendet; Soll und Urteil vom Fahrzeug', () => {
    const allesPersonal = [p(1, 1, 'fuehrer', 30), p(2, 1, 'mannschaft', 30)];
    const m = mittelDerEinheit(
      1,
      {
        einheiten: [eh(1, null)],
        personal: [allesPersonal[0]],
        fahrzeuge: [fz(30, 1, 'F', { fuehrer: 1, unterfuehrer: 1, mannschaft: 1 })],
        material: [],
      },
      { personal: allesPersonal },
    );
    expect(m.fahrzeuge[0].besatzung).toHaveLength(1);
    expect(m.fahrzeuge[0].ist).toEqual({ fuehrer: 1, unterfuehrer: 0, mannschaft: 1 });
    expect(m.fahrzeuge[0].urteil).toBe('unterbesetzt');
  });

  it('Reihenfolge: Fahrzeuge nach Funkrufname, Besatzung EF, F, UF, M, dann Name', () => {
    const m = mittelDerEinheit(1, {
      einheiten: [eh(1, null, null, { fuehrer_id: 5 })],
      personal: [
        p(1, 1, 'mannschaft', 10, 'Zander'),
        p(2, 1, 'unterfuehrer', 10, 'Bauer'),
        p(3, 1, 'mannschaft', 10, 'Adler'),
        p(4, 1, 'fuehrer', 10, 'Yilmaz'),
        p(5, 1, 'mannschaft', 10, 'Xaver'),
        p(6, 1, null, 10, 'Abel'),
      ],
      fahrzeuge: [fz(10, 1, 'Florian 10'), fz(11, 1, 'Florian 9')],
      material: [],
    });
    expect(m.fahrzeuge.map((f) => f.fahrzeug.funkrufname)).toEqual(['Florian 9', 'Florian 10']);
    const besatzung = m.fahrzeuge[1].besatzung;
    expect(besatzung.map((x) => x.person.name)).toEqual([
      'Xaver',
      'Yilmaz',
      'Bauer',
      'Adler',
      'Zander',
      'Abel',
    ]);
    expect(besatzung[0].istFuehrer).toBe(true);
  });

  it('Material ist eine Gruppe; Ausfall sind die Status mit Rolle alarm oder achtung', () => {
    const m = mittelDerEinheit(1, {
      einheiten: [eh(1, null)],
      personal: [],
      fahrzeuge: [],
      material: [mt(1, 1, 'einsatzbereit'), mt(2, 1, 'defekt'), mt(3, 1, 'im_einsatz')],
    });
    expect(m.material.map((x) => x.id)).toEqual([1, 2, 3]);
    expect(m.materialAusfall).toBe(1);
    expect(istMaterialAusfall('verbraucht')).toBe(true);
    expect(istMaterialAusfall('desinfektion_noetig')).toBe(true);
    expect(istMaterialAusfall('im_einsatz')).toBe(false);
    expect(materialAusfall([mt(4, 1, 'verbraucht'), mt(5, 1, 'einsatzbereit')])).toBe(1);
  });
});

// ── 1.3 Besatzungsrechnung ───────────────────────────────────────────────────

describe('besatzungsStaerke / besatzungsUrteilVon', () => {
  it('zählt eine Kraft ohne Position als Mannschaft', () => {
    expect(besatzungsStaerke([p(1, 1, 'fuehrer'), p(2, 1, null), p(3, 1, 'unterfuehrer')])).toEqual(
      { fuehrer: 1, unterfuehrer: 1, mannschaft: 1 },
    );
  });

  it('nicht erfasst vor allem anderen, dann kein Soll, erfüllt oder unterbesetzt', () => {
    const ist = { fuehrer: 1, unterfuehrer: 0, mannschaft: 3 };
    expect(besatzungsUrteilVon(0, ist, null)).toBe('nicht_erfasst');
    expect(besatzungsUrteilVon(4, ist, null)).toBe('kein_soll');
    expect(besatzungsUrteilVon(4, ist, { fuehrer: 1, unterfuehrer: 0, mannschaft: 2 })).toBe(
      'erfuellt',
    );
    expect(besatzungsUrteilVon(4, ist, { fuehrer: 1, unterfuehrer: 1, mannschaft: 2 })).toBe(
      'unterbesetzt',
    );
  });
});

// ── 1.4 Kumulation und „jede Kraft genau einmal“ ────────────────────────────

const eigeneStaerke =
  (personal: readonly EinsatzPersonal[]) =>
  (e: Einheit): StaerkeSumme =>
    verdichte(
      personal.filter((x) => x.einheit_id === e.id),
      [],
      [],
    ).staerke;

describe('kumuliere', () => {
  it('Eltern = eigen + Σ Kinder; Kinder ihre eigene Teilsumme', () => {
    // Zug 1/1/2, Gruppen 0/1/8 und 0/1/8 → Zug 1/3/18//22.
    const personal = [
      p(1, 1, 'fuehrer'),
      p(2, 1, 'unterfuehrer'),
      p(3, 1),
      p(4, 1),
      ...[2, 3].flatMap((g) => [
        p(g * 100, g, 'unterfuehrer'),
        ...Array.from({ length: 8 }, (_, i) => p(g * 100 + i + 1, g)),
      ]),
    ];
    const baum = einheitenBaum([eh(1, null), eh(2, null, 1), eh(3, null, 1)], []);
    const k = kumuliere(baum, eigeneStaerke(personal));
    expect(staerkeText(k.get(1))).toBe('1/3/18//22');
    expect(staerkeText(k.get(2))).toBe('0/1/8//9');
    expect(staerkeText(k.get(3))).toBe('0/1/8//9');
  });
});

describe('kraeftebaum', () => {
  const einheiten = [
    eh(1, 10, null, { name: 'Zug' }),
    eh(2, null, 1, { name: 'Gr 1' }),
    eh(3, null, 1, { name: 'Gr 2' }),
    eh(4, null, 99, { name: 'Waise' }),
  ];
  const personal = [
    p(1, 1, 'fuehrer', 10),
    p(2, 2, 'unterfuehrer', 20),
    p(3, 2, 'mannschaft', 30), // Gr 1, sitzt auf dem Fahrzeug von Gr 2
    p(4, 3),
    p(5, null),
    p(6, 999), // Einheit nicht in der Liste
    p(7, 4),
    p(8, null, 'mannschaft', 10), // ohne Einheit auf dem Zugfahrzeug
  ];
  const fahrzeuge = [fz(10, 1), fz(20, 2), fz(30, 3), fz(40, null)];
  const material = [mt(1, 1, 'defekt'), mt(2, null, 'einsatzbereit')];
  const wurzeln = kraeftebaum({
    abschnitte: [ab(10)],
    einheiten,
    personal,
    fahrzeuge,
    material,
  });

  it('Wurzeln sind eine Liste mit Art; „Ohne Einheit“ ist die letzte', () => {
    expect(wurzeln.map((w) => w.art)).toEqual(['einheit', 'einheit', 'ohne-einheit']);
    const [zug] = wurzeln;
    if (zug.art !== 'einheit') throw new Error('Einheit erwartet');
    expect(ids([zug.knoten])).toEqual([[1, [2, 3]]]);
  });

  it('jede Kraft genau einmal — auch auf fremdem Fahrzeug und ohne Einheit', () => {
    const gesehen: number[] = [];
    const fahrzeugeGesehen: number[] = [];
    const sammle = (m: KraeftebaumKnoten['mittel']) => {
      for (const f of m.fahrzeuge) {
        fahrzeugeGesehen.push(f.fahrzeug.id);
        gesehen.push(...f.besatzung.map((x) => x.person.id));
      }
      gesehen.push(...m.ohneFahrzeug.map((x) => x.person.id));
    };
    const gehe = (k: KraeftebaumKnoten) => {
      sammle(k.mittel);
      k.kinder.forEach(gehe);
    };
    for (const w of wurzeln) {
      if (w.art === 'einheit') gehe(w.knoten);
      else sammle(w.mittel);
    }
    expect(gesehen.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(fahrzeugeGesehen.sort((a, b) => a - b)).toEqual([10, 20, 30, 40]);
    // Person 3 (Gr 1) auf dem Fahrzeug von Gr 2: bei Gr 1 mit „fährt auf“.
    const zug = wurzeln[0];
    if (zug.art !== 'einheit') throw new Error('Einheit erwartet');
    const gr1 = zug.knoten.kinder[0];
    expect(gr1.mittel.ohneFahrzeug).toEqual([
      expect.objectContaining({ faehrtAuf: 'F30', person: personal[2] }),
    ]);
    const gr2 = zug.knoten.kinder[1];
    expect(gr2.mittel.fahrzeuge[0].fremd).toEqual([{ einheit: 'Gr 1', anzahl: 1 }]);
    // Das Zugfahrzeug zählt die Kraft ohne Einheit mit.
    expect(zug.knoten.mittel.fahrzeuge[0].fremd).toEqual([{ einheit: 'ohne Einheit', anzahl: 1 }]);
  });

  it('Σ Wurzeln = verdichte(...).staerke', () => {
    const k = kumuliere(
      wurzeln.flatMap((w) => (w.art === 'einheit' ? [w.knoten] : [])),
      eigeneStaerke(personal),
    );
    const summe = { fuehrer: 0, unterfuehrer: 0, mannschaft: 0, gesamt: 0 };
    for (const w of wurzeln) {
      const s =
        w.art === 'einheit'
          ? k.get(w.knoten.einheit.id)!
          : verdichte(
              [...w.mittel.ohneFahrzeug.map((x) => x.person)].concat(
                w.mittel.fahrzeuge.flatMap((f) => f.besatzung.map((x) => x.person)),
              ),
              [],
              [],
            ).staerke;
      summe.fuehrer += s.fuehrer;
      summe.unterfuehrer += s.unterfuehrer;
      summe.mannschaft += s.mannschaft;
      summe.gesamt += s.gesamt;
    }
    expect(staerkeText(summe)).toBe(staerkeText(verdichte(personal, fahrzeuge, []).staerke));
  });
});

// ── 1.5 Ausklappstufen ───────────────────────────────────────────────────────

describe('schluesselBisStufe / stufeVon', () => {
  const z = (key: string, art: string, children?: StufenZeile[]): StufenZeile => ({
    key,
    art,
    children,
  });
  const zeilen: StufenZeile[] = [
    z('eh-1', 'einheit', [
      z('ef-1', 'fahrzeug', [z('ep-1', 'person')]),
      z('mtl-1', 'material-gruppe', [z('em-1', 'material')]),
      z('eh-2', 'einheit', [z('ep-2', 'person')]),
    ]),
    z('eh-3', 'einheit'),
    z('eh-ohne', 'einheit', [z('ep-3', 'person')]),
  ];

  it('„Einheiten“ öffnet nur Knoten mit Einheit-Kindern', () => {
    expect(schluesselBisStufe(zeilen, 'einheiten')).toEqual(['eh-1']);
  });

  it('„mit Fahrzeugen“ öffnet jede Einheit mit Kindern, Fahrzeuge und Gruppen bleiben zu', () => {
    expect(schluesselBisStufe(zeilen, 'fahrzeuge')).toEqual(['eh-1', 'eh-2', 'eh-ohne']);
  });

  it('„alles“ öffnet jeden Knoten mit Kindern', () => {
    expect(schluesselBisStufe(zeilen, 'alles')).toEqual([
      'eh-1',
      'ef-1',
      'mtl-1',
      'eh-2',
      'eh-ohne',
    ]);
  });

  it('die Stufe ist aus den offenen Schlüsseln abgeleitet', () => {
    expect(stufeVon(zeilen, ['eh-1'])).toBe('einheiten');
    expect(stufeVon(zeilen, [])).toBe('einheiten');
    expect(stufeVon(zeilen, ['eh-ohne', 'eh-2', 'eh-1'])).toBe('fahrzeuge');
    expect(stufeVon(zeilen, schluesselBisStufe(zeilen, 'alles'))).toBe('alles');
    // Ein einzeln zugeklapptes Fahrzeug fällt auf die nächste vollständige Stufe zurück.
    expect(stufeVon(zeilen, ['eh-1', 'eh-2', 'eh-ohne', 'mtl-1'])).toBe('fahrzeuge');
  });
});
