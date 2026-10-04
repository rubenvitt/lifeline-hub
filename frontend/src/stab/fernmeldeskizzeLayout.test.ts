import { describe, expect, it } from 'vitest';
import type {
  Fernmeldeskizze,
  KommunikationsStelleMitKanaelen,
  SkizzenLage,
} from '../api/fernmeldeskizzeVertrag';
import type { Einheit, Einsatzabschnitt, Sprechgruppe } from '../api/types';
import {
  baueFernmeldenetz,
  type Fernmeldenetz,
  type FernmeldenetzQuellen,
} from './fernmeldeskizze';
import {
  KASTEN_BREITE,
  RASTER,
  SCHIENE_LINIE_VERSATZ,
  SPUR_HOEHE,
  layoutFernmeldenetz,
  stellenMasse,
  type Platz,
} from './fernmeldeskizzeLayout';
import type { Quelle } from './luecken';
import { sammelschienenMindestbreite } from './skizzenZeichen';

/** Auto-Layout der Fernmeldeskizze (LFH-893 D4): Szenarien aus `stab-fernmeldeskizze-bearbeitung`. */

function sg(id: number, betriebsart: 'TMO' | 'DMO', bezeichnung: string): Sprechgruppe {
  return { id, bezeichnung, betriebsart, aktiv: true, einsatz_lokal: false, sortier: id };
}

function abschnitt(id: number, p: Partial<Einsatzabschnitt> = {}): Einsatzabschnitt {
  return { id, einsatz_id: 1, name: `EA ${id}`, sortier: id, sprechgruppen: [], ...p };
}

function einheit(id: number, p: Partial<Einheit> = {}): Einheit {
  return {
    id,
    einsatz_id: 1,
    name: `Einheit ${id}`,
    sortier: id,
    sprechgruppen: [],
    fahrzeug_mitglieder: [],
    material_mitglieder: [],
    personal_mitglieder: [],
    ist: { fuehrer: 0, unterfuehrer: 0, mannschaft: 0 },
    ist_kumuliert: { fuehrer: 0, unterfuehrer: 0, mannschaft: 0 },
    status: { quelle: 'ohne', verteilung: [] },
    ...p,
  } as Einheit;
}

const daten = <T>(d: T[]): Quelle<T> => ({ zustand: 'daten', daten: d });

const LEER_SKIZZE: Fernmeldeskizze = {
  lage: [],
  komponenten: [],
  verbindungen: [],
  bereiche: [],
  schriftfeld: {
    herausgeber: null,
    vs_vermerk: 'keiner',
    gueltig_ab: null,
    gez_name: null,
    gez_at: null,
  },
  stand: null,
};

function netz(
  p: {
    abschnitte?: Einsatzabschnitt[];
    einheiten?: Einheit[];
    fs?: Sprechgruppe[] | null;
    stellen?: KommunikationsStelleMitKanaelen[];
    skizze?: Partial<Fernmeldeskizze>;
  } = {},
): Fernmeldenetz {
  const q: FernmeldenetzQuellen = {
    einsatzId: 1,
    abschnitte: daten(p.abschnitte ?? []),
    einheiten: daten(p.einheiten ?? []),
    fuehrungsstelle: {
      zustand: 'daten',
      daten:
        p.fs === null || p.fs === undefined
          ? null
          : { rufname: 'Florian 10/1', sprechgruppen: p.fs },
    },
    sprechgruppen: daten([]),
    stellen: daten(p.stellen ?? []),
    skizze: { zustand: 'daten', daten: { ...LEER_SKIZZE, ...p.skizze } },
  };
  return baueFernmeldenetz(q);
}

const unten = (p: Platz) => p.y + p.hoehe;
const rechts = (p: Platz) => p.x + p.breite;
function ueberlappen(a: Platz, b: Platz): boolean {
  return a.x < rechts(b) && b.x < rechts(a) && a.y < unten(b) && b.y < unten(a);
}
function platz(plaetze: Map<string, Platz>, key: string): Platz {
  const p = plaetze.get(key);
  if (!p) throw new Error(`${key} ohne Platz`);
  return p;
}

/** Acht oberste Abschnitte mit je drei Einheiten mit je zwei Sprechgruppen (Spec „Viele Abschnitte“). */
function achtMalDrei(): Fernmeldenetz {
  const BOS = sg(1, 'TMO', 'BN_BOS');
  const abschnitte = Array.from({ length: 8 }, (_, i) =>
    abschnitt(i + 1, {
      name: `EA ${i + 1} Gesundheit und Betreuung`,
      sprechgruppen: [BOS, sg(10 + i, 'TMO', `EA_${i + 1}`)],
    }),
  );
  const einheiten = abschnitte.flatMap((a, i) =>
    Array.from({ length: 3 }, (_, j) =>
      einheit(100 + i * 3 + j, {
        abschnitt_id: a.id,
        funkrufname: `Florian Musterstadt ${i + 1}/${j + 1}`,
        sprechgruppen: [
          sg(10 + i, 'TMO', `EA_${i + 1}`),
          sg(100 + i * 3 + j, 'DMO', `314_F${i}${j}`),
        ],
      }),
    ),
  );
  return netz({ abschnitte, einheiten, fs: [BOS] });
}

describe('layoutFernmeldenetz · Auto-Layout aus der Führungsorganisation', () => {
  it('Erstes Öffnen: Führungsstelle oben, Abschnitte in zwei Spalten, Einheiten darunter', () => {
    const n = netz({
      fs: [],
      abschnitte: [abschnitt(1), abschnitt(2)],
      einheiten: [
        einheit(10, { abschnitt_id: 1 }),
        einheit(11, { abschnitt_id: 1 }),
        einheit(20, { abschnitt_id: 2 }),
        einheit(21, { abschnitt_id: 2 }),
      ],
    });
    const { plaetze } = layoutFernmeldenetz(n);
    const fs = platz(plaetze, 'fs');
    const [a1, a2] = [platz(plaetze, 'ab-1'), platz(plaetze, 'ab-2')];
    expect(a1.y).toBeGreaterThanOrEqual(unten(fs));
    expect(a2.y).toBe(a1.y);
    expect(a2.x).toBeGreaterThanOrEqual(rechts(a1));
    for (const [e, a] of [
      ['eh-10', a1],
      ['eh-11', a1],
      ['eh-20', a2],
      ['eh-21', a2],
    ] as const) {
      const p = platz(plaetze, e);
      expect(p.y).toBeGreaterThanOrEqual(unten(a));
      // In der Spalte seines Abschnitts: weder links davor noch in der Nachbarspalte.
      expect(p.x).toBeGreaterThanOrEqual(a.x);
      expect(p.x).toBeLessThan(a === a1 ? a2.x : Infinity);
    }
    expect(platz(plaetze, 'eh-11').y).toBeGreaterThanOrEqual(unten(platz(plaetze, 'eh-10')));
    for (const p of plaetze.values()) expect(p.quelle).toBe('auto');
  });

  it('platziert jedes Element auf Rasterpunkten', () => {
    const n = achtMalDrei();
    const { plaetze, breite, hoehe } = layoutFernmeldenetz(n);
    const alle = [...n.stellen.map((s) => s.key), ...n.schienen.map((s) => s.key)];
    expect([...plaetze.keys()].sort()).toEqual(alle.sort());
    for (const p of plaetze.values()) {
      for (const v of [p.x, p.y, p.breite, p.hoehe]) expect(v % RASTER).toBe(0);
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(rechts(p)).toBeLessThanOrEqual(breite);
      expect(unten(p)).toBeLessThanOrEqual(hoehe);
    }
  });

  it('überlappt bei acht Abschnitten mit je drei Einheiten keine Kästen und keine Schienen', () => {
    const n = achtMalDrei();
    const { plaetze } = layoutFernmeldenetz(n);
    const elemente = [...plaetze.entries()];
    for (let i = 0; i < elemente.length; i++) {
      for (let j = i + 1; j < elemente.length; j++) {
        const [ka, a] = elemente[i];
        const [kb, b] = elemente[j];
        expect(ueberlappen(a, b), `${ka} überlappt ${kb}`).toBe(false);
      }
    }
  });

  it('legt jede Schiene waagerecht unter ihren höchsten Teilnehmer und über alle Stichleitungen', () => {
    const n = achtMalDrei();
    const { plaetze } = layoutFernmeldenetz(n);
    const fs = platz(plaetze, 'fs');
    const ea1 = platz(plaetze, 'ab-1');
    const bos = platz(plaetze, 'sg-1');
    // BN_BOS trägt die Führungsstelle: unter ihr, über den Abschnitten.
    expect(bos.y).toBeGreaterThanOrEqual(unten(fs));
    expect(unten(bos)).toBeLessThanOrEqual(ea1.y);
    // Die Schiene des Abschnitts liegt unter ihm, über seinen Einheiten.
    const ea1Schiene = platz(plaetze, 'sg-10');
    expect(ea1Schiene.y).toBeGreaterThanOrEqual(unten(ea1));
    expect(unten(ea1Schiene)).toBeLessThanOrEqual(platz(plaetze, 'eh-100').y);
    // Jede Stichleitung trifft die Schiene: ihr Anschluss liegt innerhalb der Linie.
    for (const s of n.schienen) {
      const p = platz(plaetze, s.key);
      expect(p.breite).toBeGreaterThanOrEqual(
        sammelschienenMindestbreite(s.betriebsart, s.bezeichnung),
      );
      for (const t of s.teilnehmer) {
        const anschluss = platz(plaetze, t.element).steigX ?? platz(plaetze, t.element).x;
        expect(anschluss).toBeGreaterThanOrEqual(p.x);
        expect(anschluss).toBeLessThanOrEqual(rechts(p));
      }
      // Das Bedingungszeichen liegt rechts neben der letzten Stichleitung, nicht auf einer.
      const anschluesse = s.teilnehmer.map((t) => platz(plaetze, t.element).steigX ?? 0);
      expect(p.zeichenX).not.toBeNull();
      expect(p.zeichenX!).toBeGreaterThan(Math.max(...anschluesse));
      expect(p.y + SCHIENE_LINIE_VERSATZ).toBeLessThan(unten(p));
    }
  });

  it('führt Steigleitungen links neben den Kästen ihrer Spalte, je Stelle eine eigene', () => {
    const n = achtMalDrei();
    const { plaetze } = layoutFernmeldenetz(n);
    const spalte = ['ab-1', 'eh-100', 'eh-101', 'eh-102'].map((k) => platz(plaetze, k));
    const steig = spalte.map((p) => p.steigX);
    expect(new Set(steig).size).toBe(4);
    const links = Math.min(...spalte.map((p) => p.x));
    for (const x of steig) expect(x!).toBeLessThan(links);
  });

  it('stellt externe Stellen in eine Spalte rechts, Komponenten neben ihre erste Schiene', () => {
    const SL = sg(3, 'TMO', 'SL AS');
    const F314 = sg(2, 'DMO', '314_F*');
    const n = netz({
      fs: [SL],
      abschnitte: [
        abschnitt(1, { sprechgruppen: [F314] }),
        abschnitt(2, { sprechgruppen: [F314] }),
      ],
      stellen: [
        {
          id: 5,
          stellenart: 'leitstelle',
          bezeichnung: 'ILS Musterhausen',
          verbindungen: [],
          sprechgruppen: [{ sprechgruppe: SL, status: 'geplant' }],
        },
        {
          id: 6,
          stellenart: 'behoerde',
          bezeichnung: 'Polizei',
          verbindungen: [],
          sprechgruppen: [],
        },
      ],
      skizze: {
        komponenten: [{ id: 9, art: 'repeater', bezeichnung: null, sprechgruppen: [F314] }],
      },
    });
    const { plaetze } = layoutFernmeldenetz(n);
    const baumRechts = Math.max(...['fs', 'ab-1', 'ab-2'].map((k) => rechts(platz(plaetze, k))));
    const ks5 = platz(plaetze, 'ks-5');
    const ks6 = platz(plaetze, 'ks-6');
    expect(ks5.x).toBeGreaterThan(baumRechts);
    expect(ks6.x).toBe(ks5.x);
    expect(ks6.y).toBeGreaterThanOrEqual(unten(ks5));
    // Die Schiene der Leitstelle reicht bis an die Spalte der externen Stellen.
    const sl = platz(plaetze, 'sg-3');
    expect(rechts(sl)).toBeGreaterThan(baumRechts);
    expect(rechts(sl)).toBeLessThanOrEqual(ks5.x);
    // Der Repeater sitzt auf der Linie von 314_F*, rechts von ihrem Ende.
    const f314 = platz(plaetze, 'sg-2');
    const ko = platz(plaetze, 'ko-9');
    expect(ko.x).toBeGreaterThanOrEqual(rechts(f314));
    expect(ko.y).toBeLessThanOrEqual(f314.y + SCHIENE_LINIE_VERSATZ);
    expect(unten(ko)).toBeGreaterThanOrEqual(f314.y + SCHIENE_LINIE_VERSATZ);
    const elemente = [...plaetze.entries()];
    for (let i = 0; i < elemente.length; i++) {
      for (let j = i + 1; j < elemente.length; j++) {
        expect(
          ueberlappen(elemente[i][1], elemente[j][1]),
          `${elemente[i][0]} / ${elemente[j][0]}`,
        ).toBe(false);
      }
    }
  });

  it('legt Schienen ohne Teilnehmer in eine eigene Zeile unten', () => {
    const lokal = { ...sg(9, 'DMO', '999'), einsatz_lokal: true };
    const n = baueFernmeldenetz({
      einsatzId: 1,
      abschnitte: daten([abschnitt(1), abschnitt(2)]),
      einheiten: daten([einheit(10, { abschnitt_id: 1 })]),
      fuehrungsstelle: { zustand: 'daten', daten: null },
      sprechgruppen: daten([lokal]),
      stellen: daten([]),
      skizze: { zustand: 'daten', daten: LEER_SKIZZE },
    });
    const { plaetze } = layoutFernmeldenetz(n);
    const s = platz(plaetze, 'sg-9');
    expect(s.y).toBeGreaterThanOrEqual(unten(platz(plaetze, 'eh-10')));
    expect(s.zeichenX).toBeNull();
  });
});

describe('layoutFernmeldenetz · gespeicherte und gehaltene Lage', () => {
  const lage = (
    element: string,
    x: number,
    y: number,
    breite: number | null = null,
  ): SkizzenLage => ({
    element,
    x,
    y,
    breite,
    version: 3,
  });

  it('gibt der gespeicherten Lage Vorrang und rechnet die Schiene nach der verschobenen Stelle', () => {
    const BOS = sg(1, 'TMO', 'BN_BOS');
    const n = netz({
      abschnitte: [abschnitt(1, { sprechgruppen: [BOS] }), abschnitt(2, { sprechgruppen: [BOS] })],
      skizze: { lage: [lage('ab-2', 1600, 40), lage('sg-7', 0, 0)] },
    });
    const { plaetze } = layoutFernmeldenetz(n);
    expect(platz(plaetze, 'ab-2')).toMatchObject({
      x: 1600,
      y: 40,
      quelle: 'gespeichert',
      steigX: null,
    });
    expect(platz(plaetze, 'ab-1').quelle).toBe('auto');
    const bos = platz(plaetze, 'sg-1');
    expect(rechts(bos)).toBeGreaterThanOrEqual(1600 + KASTEN_BREITE / 2);
  });

  it('übernimmt die gespeicherte Breite einer Schiene', () => {
    const BOS = sg(1, 'TMO', 'BN_BOS');
    const n = netz({ fs: [BOS], skizze: { lage: [lage('sg-1', 400, 240, 640)] } });
    expect(platz(layoutFernmeldenetz(n).plaetze, 'sg-1')).toMatchObject({
      x: 400,
      y: 240,
      breite: 640,
      hoehe: SPUR_HOEHE,
      quelle: 'gespeichert',
    });
  });

  it('Ruhige Fläche: gehaltene Elemente bleiben, neue sind markiert', () => {
    const vorher = netz({
      abschnitte: [abschnitt(1)],
      einheiten: [einheit(10, { abschnitt_id: 1 })],
    });
    const gehalten = layoutFernmeldenetz(vorher).plaetze;
    const nachher = netz({
      abschnitte: [abschnitt(1), abschnitt(0, { sortier: -1, name: 'EA 0' })],
      einheiten: [einheit(10, { abschnitt_id: 1 }), einheit(11, { abschnitt_id: 1 })],
    });
    const { plaetze } = layoutFernmeldenetz(nachher, { gehalten });
    for (const key of ['fs', 'ab-1', 'eh-10']) {
      expect(platz(plaetze, key)).toMatchObject({
        x: gehalten.get(key)!.x,
        y: gehalten.get(key)!.y,
        quelle: 'gehalten',
        neu: false,
      });
    }
    expect(platz(plaetze, 'eh-11').neu).toBe(true);
    expect(platz(plaetze, 'ab-0').neu).toBe(true);
    // Ohne `gehalten` ist nichts neu.
    expect([...layoutFernmeldenetz(nachher).plaetze.values()].some((p) => p.neu)).toBe(false);
  });
});

describe('stellenMasse', () => {
  it('lässt einen Kasten mit langer Bezeichnung mitwachsen, statt sie zu kürzen', () => {
    const kurz = netz({ abschnitte: [abschnitt(1, { name: 'EA 1' })] }).stellen[1];
    const lang = netz({
      abschnitte: [abschnitt(1, { name: 'EA 1 Gesundheit, Betreuung und Verpflegung im Süden' })],
    }).stellen[1];
    expect(stellenMasse(kurz).breite).toBe(KASTEN_BREITE);
    expect(stellenMasse(lang).hoehe).toBeGreaterThan(stellenMasse(kurz).hoehe);
    expect(stellenMasse(lang).hoehe % RASTER).toBe(0);
  });

  // Messung 1.1 (e2e `fernmeldeskizze.spec.ts`): ein Rufname mit 30 Zeichen ist breiter als der
  // Platz einer Einheit; er bricht um und der Platz wächst mit, statt dass der Text übersteht.
  it('lässt eine Einheit mit langem Rufname mitwachsen', () => {
    const mit = (funkrufname: string) =>
      netz({ einheiten: [einheit(1, { funkrufname })] }).stellen.find((s) => s.key === 'eh-1')!;
    const kurz = mit('Florian 1/1');
    const lang = mit('Florian Musterstadt-Nord 12/34');
    expect(stellenMasse(lang).breite).toBe(stellenMasse(kurz).breite);
    expect(stellenMasse(lang).hoehe).toBeGreaterThan(stellenMasse(kurz).hoehe);
  });

  it('rechnet die Zeilen wie das Bild: Umbruch an Wortgrenzen, nicht Zeichen durch Breite', () => {
    // Je 40 Zeichen, geschätzt 40 · 12 · 0,6 = 288 = 2 · 144. Ohne Leerzeichen bricht das Bild
    // zeichenweise in zwei Zeilen, an Wortgrenzen (18 + 18 + 2) aber in drei.
    const mit = (name: string) =>
      netz({ einheiten: [einheit(1, { name })] }).stellen.find((s) => s.key === 'eh-1')!;
    const zwei = mit('X'.repeat(40));
    const drei = mit(`${'A'.repeat(18)} ${'B'.repeat(18)} Cc`);
    expect(stellenMasse(drei).hoehe).toBeGreaterThan(stellenMasse(zwei).hoehe);
  });
});
