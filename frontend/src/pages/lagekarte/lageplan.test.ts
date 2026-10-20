import { describe, expect, it } from 'vitest';
import { FACHEBENEN } from './fachebenen';
import {
  LAGEPLAN_BILD_MAX_MM,
  lageplanBildHoehe,
  lageplanFlaeche,
  lageplanLegende,
  legendenTexte,
  massstabLeiste,
  massstabZahl,
  massstabZahlText,
  nordpfeilDrehung,
  veraltetHinweis,
  type LegendenQuellen,
} from './lageplan';

describe('massstabLeiste', () => {
  it('nimmt die längste runde Strecke, die in ein Viertel der Bildbreite passt', () => {
    // 1000 px × 2 m = 2000 m Breite, ein Viertel 500 m.
    expect(massstabLeiste(2, 1000)).toEqual({ meter: 500, text: '500 m', anteil: 0.25 });
    // ein Viertel 450 m → 200 m (5 × 100 passt nicht).
    expect(massstabLeiste(1.8, 1000)).toEqual({ meter: 200, text: '200 m', anteil: 200 / 1800 });
    // ein Viertel 3 km → 2 km.
    expect(massstabLeiste(12, 1000)?.text).toBe('2 km');
  });

  it('steht ohne brauchbare Angabe nicht da', () => {
    expect(massstabLeiste(null, 1000)).toBeNull();
    expect(massstabLeiste(0, 1000)).toBeNull();
    expect(massstabLeiste(Number.NaN, 1000)).toBeNull();
    expect(massstabLeiste(2, 0)).toBeNull();
  });
});

describe('massstabZahl', () => {
  it('rechnet Gelände je Papier auf zwei gültige Stellen', () => {
    // 1000 px × 2 m = 2000 m auf 267 mm → 1 : 7491 → 1 : 7500.
    expect(massstabZahl(2, 1000, 267)).toBe(7500);
    expect(massstabZahlText(7500)).toBe('1 : 7.500');
    expect(massstabZahl(null, 1000, 267)).toBeNull();
  });
});

describe('nordpfeilDrehung', () => {
  it('dreht gegen die Peilung, normiert auf 0–360', () => {
    expect(nordpfeilDrehung(0)).toBe(0);
    expect(nordpfeilDrehung(30)).toBe(330);
    expect(nordpfeilDrehung(-45)).toBe(45);
    expect(nordpfeilDrehung(360)).toBe(0);
    expect(Object.is(nordpfeilDrehung(-0), -0)).toBe(false);
    expect(nordpfeilDrehung(Number.NaN)).toBe(0);
  });
});

describe('lageplanFlaeche', () => {
  it('hält das Seitenverhältnis und füllt Breite oder Höhe', () => {
    expect(lageplanFlaeche(2000, 500)).toEqual({ breiteMm: 267, hoeheMm: 66.75 });
    const hoch = lageplanFlaeche(1000, 1000);
    expect(hoch).toEqual({ breiteMm: 95, hoeheMm: 95 });
  });

  it('nimmt eine kleinere Höchsthöhe, die Breite folgt dem Seitenverhältnis', () => {
    expect(lageplanFlaeche(1000, 500, { ...LAGEPLAN_BILD_MAX_MM, hoehe: 45 })).toEqual({
      breiteMm: 90,
      hoeheMm: 45,
    });
  });
});

describe('lageplanBildHoehe', () => {
  it('gibt dem Bild, was Kopf, Maßstabszeile und Legende vom Blatt übrig lassen', () => {
    // 177 mm Blatt: Rest 82 mm → 95 mm (größte Fläche), Rest 100 mm → 77 mm.
    expect(lageplanBildHoehe(70)).toBe(95);
    expect(lageplanBildHoehe(82)).toBe(95);
    expect(lageplanBildHoehe(100)).toBe(77);
    expect(lageplanBildHoehe(100.04)).toBe(76.9);
  });

  it('wird nicht kleiner als 35 mm und nimmt ohne Messung die größte Fläche', () => {
    expect(lageplanBildHoehe(160)).toBe(35);
    expect(lageplanBildHoehe(0)).toBe(95);
    expect(lageplanBildHoehe(Number.NaN)).toBe(95);
  });
});

const ZONE_STIL = { fillColor: '#cf1322', fillOpacity: 0.2, lineColor: '#cf1322', lineWidth: 2 };
const jetzt = Date.parse('2026-10-20T12:00:00Z');

function quellen(teil: Partial<LegendenQuellen> = {}): LegendenQuellen {
  return {
    marker: [],
    abschnitte: 0,
    zonen: [],
    fachebenen: [],
    abgerufen: {},
    bilder: [],
    jetztMs: jetzt,
    formatZeitKurz: (iso) => iso.slice(11, 16).replace(':', ''),
    ...teil,
  };
}

describe('lageplanLegende', () => {
  it('nennt nur gezeichnete Ebenen, in der Folge der Leiste und mit Zahl', () => {
    const legende = lageplanLegende(
      quellen({
        marker: [{ typ: 'schaden' }, { typ: 'einheit' }, { typ: 'einheit' }, { typ: 'einsatzort' }],
        abschnitte: 2,
      }),
    );
    expect(legende.ebenen.map((z) => z.text)).toEqual([
      'Einsatzort (1)',
      'Einheiten (2)',
      'Abschnitte (2)',
      'Schäden (1)',
    ]);
  });

  it('nennt eine gesperrte Ebene nicht: ohne gezeichnete Objekte keine Zeile', () => {
    // Betroffene eingeschaltet, aber das Modul Personen ist gesperrt: die Quelle liefert nichts.
    const legende = lageplanLegende(quellen({ marker: [{ typ: 'einheit' }] }));
    const texte = legendenTexte(legende).join(' | ');
    expect(texte).not.toMatch(/Betroffene|Betreuungsstellen|Bereitstellungsräume|UHS/);
    expect(texte).toBe('Einheiten (1)');
  });

  it('führt jede Zone mit Beschriftung samt Warnstufe, sonst mit dem Typwort', () => {
    const legende = lageplanLegende(
      quellen({
        zonen: [
          {
            id: 1,
            label: 'Brandstelle · Warnstufe: hoch',
            typ: 'gefahrengebiet',
            stil: ZONE_STIL,
            gestrichelt: true,
          },
          { id: 2, label: null, typ: 'absperrbereich', stil: ZONE_STIL },
        ],
      }),
    );
    expect(legende.zonen).toEqual([
      expect.objectContaining({ text: 'Brandstelle · Warnstufe: hoch', gestrichelt: true }),
      expect.objectContaining({ text: 'Absperrbereich', gestrichelt: false }),
    ]);
  });

  it('nennt den Stand jeder Fachebene und hebt veraltete hervor', () => {
    const pegel = FACHEBENEN.pegelonline;
    const dwd = FACHEBENEN.dwd;
    const legende = lageplanLegende(
      quellen({
        fachebenen: [{ def: pegel }, { def: dwd }],
        abgerufen: {
          // weit jenseits der Schwelle des Pegels
          pegelonline: new Date(jetzt - (pegel.veraltetNachMin + 5) * 60_000).toISOString(),
          dwd: new Date(jetzt - 60_000).toISOString(),
        },
      }),
    );
    expect(legende.fachebenen[0]).toMatchObject({ veraltet: true });
    expect(legende.fachebenen[0].text).toMatch(/^Pegel \/ Hochwasser · veraltet · Stand \d{4}$/);
    expect(legende.fachebenen[1]).toMatchObject({ veraltet: false });
    expect(legende.fachebenen[1].text).toBe(`${dwd.label} · Stand 1159`);
    expect(veraltetHinweis(legende)).toMatch(/^Veraltete Fachebene: Pegel \/ Hochwasser \(Stand/);
  });

  it('ohne veraltete Ebene kein Hinweis, ohne Stand keine Zeit', () => {
    const legende = lageplanLegende(quellen({ fachebenen: [{ def: FACHEBENEN.dwd }] }));
    expect(legende.fachebenen[0].text).toBe(FACHEBENEN.dwd.label);
    expect(veraltetHinweis(legende)).toBeNull();
  });

  it('listet sichtbare Bild-Hintergründe', () => {
    const legende = lageplanLegende(quellen({ bilder: [{ id: 3, name: 'Hallenplan' }] }));
    expect(legendenTexte(legende)).toEqual(['Bild: Hallenplan']);
  });
});
