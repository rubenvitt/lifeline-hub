import { describe, it, expect } from 'vitest';
import { theme } from 'antd';
import {
  GRIFF_BODEN,
  GRIFF_KERN,
  griffHinweis,
  griffKante,
  griffStil,
  griffeFuerModus,
  scharfeGriffe,
  type GriffArt,
  type GriffPunkte,
  type GriffKontext,
  type GriffModus,
} from './bildGriffe';
import { antdToken, farbenDunkel, farbenHell, type Dichte } from '../../theme/tokens';

/**
 * Die Ziehgriffe eines Bild-Overlays: jeder Griff ist ein durchsichtiger Container in Stufengröße
 * (mindestens 44 px) mit farbigem Kern — die sichtbare Größe bleibt, die anfassbare wächst. Die
 * Steuerhöhe kommt aus dem echten Dichte-Helfer (`antdToken`), die Böden stehen als Literale.
 */
const ARTEN: GriffArt[] = ['eck', 'kante', 'dreh', 'mitte'];

function kontext(dichte: Dichte, farben = farbenDunkel): GriffKontext {
  const t = theme.getDesignToken({ token: antdToken(farben, dichte) });
  return { controlHeight: t.controlHeight, bedien: farben.bedien };
}

describe('griffStil', () => {
  for (const { dichte, boden } of [
    { dichte: 'kompakt', boden: 44 },
    { dichte: 'komfortabel', boden: 48 },
    { dichte: 'handschuh', boden: 72 },
  ] as const) {
    it(`gibt jedem Griff in „${dichte}" einen ${boden}-px-Container`, () => {
      for (const art of ARTEN) {
        const s = griffStil(art, kontext(dichte));
        expect(s.container, art).toContain(`width:${boden}px`);
        expect(s.container, art).toContain(`height:${boden}px`);
        // Durchsichtig: die Vergrößerung darf das Bild darunter nicht verdecken.
        expect(s.container, art).toContain('background:transparent');
      }
    });
  }

  it('hält den Boden von 44 px auch dort, wo die Stufe darunter liegt', () => {
    // `kompakt` ist 30 — ein Fingerziel auf einem Bild braucht mehr (WCAG 2.5.5).
    expect(kontext('kompakt').controlHeight).toBe(30);
    expect(griffKante(30)).toBe(44);
    expect(GRIFF_BODEN).toBe(44);
    // Darüber gilt die Staffel, der Boden deckelt nichts.
    expect(griffKante(72)).toBe(72);
  });

  it('lässt den sichtbaren Kern klein', () => {
    // Größeres Ziel, keine größeren Griffe: ein 72-px-Quadrat in Vollfarbe verdeckte das Bild.
    for (const art of ['eck', 'kante'] as GriffArt[]) {
      expect(griffStil(art, kontext('handschuh')).kern, art).toContain(`width:${GRIFF_KERN}px`);
    }
    expect(GRIFF_KERN).toBe(12);
    expect(GRIFF_KERN).toBeLessThan(GRIFF_BODEN);
  });

  it('färbt aus der Rolle `bedien` des aktiven Modus, nicht mit antds altem Default-Blau', () => {
    for (const farben of [farbenDunkel, farbenHell]) {
      for (const art of ARTEN) {
        const s = griffStil(art, kontext('kompakt', farben));
        expect(s.kern, art).toContain(farben.bedien);
        expect(s.kern + s.container, art).not.toMatch(/#1677ff|22,\s*119,\s*255/i);
      }
    }
  });

  it('unterscheidet die Griffarten weiterhin an der Form', () => {
    // Eckgriff eckig (proportional), Kantengriff rund (frei strecken) — die einzige Ansage, was der
    // Griff tut.
    expect(griffStil('eck', kontext('kompakt')).kern).toContain('border-radius:2px');
    expect(griffStil('kante', kontext('kompakt')).kern).toContain('border-radius:50%');
  });

  it('nennt je Art einen eigenen Mauszeiger', () => {
    expect(griffStil('dreh', kontext('kompakt')).container).toContain('cursor:grab');
    expect(griffStil('mitte', kontext('kompakt')).container).toContain('cursor:move');
  });
});

/**
 * Der Modus-Umschalter: zehn große Griffe lägen auf einem kleinen Bild übereinander, deshalb ist
 * immer nur eine Sorte scharf.
 */
describe('griffeFuerModus', () => {
  it('lässt je Modus genau die passenden Arten scharf', () => {
    expect(griffeFuerModus('verschieben')).toEqual(['mitte']);
    expect([...griffeFuerModus('groesse')].sort()).toEqual(['eck', 'kante']);
    expect(griffeFuerModus('drehen')).toEqual(['dreh']);
  });

  it('lässt keine Art in zwei Modi zugleich stehen und keine unerreichbar', () => {
    // Zwei Modi mit derselben Griffsorte wären eine Beschriftung ohne Wirkung, und eine Art in
    // keinem Modus nähme eine Funktion weg.
    const alle: GriffModus[] = ['verschieben', 'groesse', 'drehen'];
    const gesehen = new Set<GriffArt>();
    for (const m of alle) {
      for (const a of griffeFuerModus(m)) {
        expect(gesehen.has(a), `${a} in mehreren Modi`).toBe(false);
        gesehen.add(a);
      }
    }
    expect(gesehen.size).toBe(4);
  });

  it('der Hinweis nennt nur die Griffe, die es gerade gibt', () => {
    // Sonst behauptete der Text weiter, man könne an den Ecken ziehen.
    expect(griffHinweis('drehen')).toMatch(/Drehen/);
    expect(griffHinweis('drehen')).not.toMatch(/Ecken|Kanten|Mitte/);
    expect(griffHinweis('verschieben')).not.toMatch(/Ecken|Kanten|↻/);
    expect(griffHinweis('groesse')).not.toMatch(/↻|Mitte/);
  });

  it('sagt, wenn Kanten wegen Platzmangel fehlen, und nennt Heranzoomen (LFH-764)', () => {
    const alle = griffHinweis('groesse', { kantenAus: 'alle' });
    expect(alle).toMatch(/Ecken/);
    expect(alle).toMatch(/heranzoomen/i);
    // Keine Anweisung für Griffe, die es gerade nicht gibt.
    expect(alle).not.toMatch(/Kanten = frei strecken/);
    // Fehlen nur einige, bleiben die übrigen Kanten bedienbar — der Hinweis nennt beides.
    const einige = griffHinweis('groesse', { kantenAus: 'einige' });
    expect(einige).toMatch(/Kanten = frei strecken/);
    expect(einige).toMatch(/heranzoomen/i);
    // Mit allen Kanten bleibt der bisherige Text, und die übrigen Modi kennen den Zustand nicht.
    expect(griffHinweis('groesse', { kantenAus: 'keine' })).toBe(griffHinweis('groesse'));
    expect(griffHinweis('groesse')).toMatch(/Kanten = frei strecken/);
    expect(griffHinweis('groesse')).not.toMatch(/heranzoomen/i);
    for (const m of ['verschieben', 'drehen'] as const) {
      expect(griffHinweis(m, { kantenAus: 'alle' })).toBe(griffHinweis(m));
    }
  });
});

/**
 * Welche Griffe scharf sind, entscheidet die Darstellung (LFH-764): Ecken immer, eine Kante nur, wenn
 * ihr Container weder eine Ecke noch eine andere Kante überlappt. Container sind achsenparallele
 * Quadrate der Griffkante um den Griffpunkt; überlappend heißt |dx| < kante UND |dy| < kante.
 */
describe('scharfeGriffe', () => {
  type P = [number, number];
  /** Griffpunkte eines Rechtecks b × h ab (0, 0), optional um seinen Mittelpunkt gedreht. */
  function rechteck(b: number, h: number, grad = 0): GriffPunkte {
    const c: P = [b / 2, h / 2];
    const r = (grad * Math.PI) / 180;
    const dreh = ([x, y]: P): P => [
      c[0] + (x - c[0]) * Math.cos(r) - (y - c[1]) * Math.sin(r),
      c[1] + (x - c[0]) * Math.sin(r) + (y - c[1]) * Math.cos(r),
    ];
    const ecken: P[] = [
      [0, 0],
      [b, 0],
      [b, h],
      [0, h],
    ];
    const mitte = (i: number, j: number): P => [
      (ecken[i][0] + ecken[j][0]) / 2,
      (ecken[i][1] + ecken[j][1]) / 2,
    ];
    return {
      eck: ecken.map(dreh) as GriffPunkte['eck'],
      kante: [mitte(0, 1), mitte(1, 2), mitte(2, 3), mitte(3, 0)].map(dreh) as GriffPunkte['kante'],
      dreh: dreh([b / 2, -28]),
      mitte: dreh(c),
    };
  }

  /** Alle scharfen Griffpunkte, um die Überlappung unabhängig von der Regel nachzurechnen. */
  function scharfePunkte(punkte: GriffPunkte, wahl: ReturnType<typeof scharfeGriffe>): P[] {
    return [
      ...punkte.eck.filter((_, i) => wahl.eck[i]),
      ...punkte.kante.filter((_, i) => wahl.kante[i]),
      ...(wahl.dreh ? [punkte.dreh] : []),
      ...(wahl.mitte ? [punkte.mitte] : []),
    ];
  }
  function ueberlappungen(ps: P[], kante: number): number {
    let n = 0;
    for (let i = 0; i < ps.length; i++)
      for (let j = i + 1; j < ps.length; j++)
        if (Math.abs(ps[i][0] - ps[j][0]) < kante && Math.abs(ps[i][1] - ps[j][1]) < kante) n++;
    return n;
  }

  it('lässt auf 120 px in „kompakt" Ecken und Kanten scharf', () => {
    const w = scharfeGriffe('groesse', rechteck(120, 120), 44);
    expect(w.eck).toEqual([true, true, true, true]);
    expect(w.kante).toEqual([true, true, true, true]);
    expect(w.kantenAus).toBe('keine');
  });

  it('nimmt auf 120 px in „handschuh" die Kanten weg, die Ecken bleiben', () => {
    const w = scharfeGriffe('groesse', rechteck(120, 120), 72);
    expect(w.eck).toEqual([true, true, true, true]);
    expect(w.kante).toEqual([false, false, false, false]);
    expect(w.kantenAus).toBe('alle');
  });

  for (const kante of [44, 48, 72]) {
    for (const grad of [0, 30, 45]) {
      it(`überlappt bei Kante ${kante} und ${grad}° auf 120 px keine zwei scharfen Griffe`, () => {
        const punkte = rechteck(120, 120, grad);
        const w = scharfeGriffe('groesse', punkte, kante);
        expect(w.eck).toEqual([true, true, true, true]);
        expect(ueberlappungen(scharfePunkte(punkte, w), kante)).toBe(0);
      });
    }
  }

  it('entscheidet symmetrisch: zwei sich überlappende Kanten fallen beide weg', () => {
    // 300 × 60 in „handschuh": oben und unten liegen 60 px auseinander. Gierig bekäme „oben" den
    // Griff und „unten" nicht — die Wahl hinge an der Aufzählreihenfolge.
    const w = scharfeGriffe('groesse', rechteck(300, 60), 72);
    expect(w.kante).toEqual([false, false, false, false]);
  });

  it('lässt auf einem langen Bild die langen Kanten scharf, wo Platz ist', () => {
    // 300 × 60 in „kompakt": links/rechts liegen 30 px neben den Ecken, oben/unten 150 px.
    const w = scharfeGriffe('groesse', rechteck(300, 60), 44);
    expect(w.kante).toEqual([true, false, true, false]);
    expect(w.kantenAus).toBe('einige');
  });

  it('lässt auf einem winzigen Bild die Ecken trotzdem scharf (dokumentierter Rest)', () => {
    const w = scharfeGriffe('groesse', rechteck(30, 30), 44);
    expect(w.eck).toEqual([true, true, true, true]);
    expect(w.kante).toEqual([false, false, false, false]);
    expect(w.kantenAus).toBe('alle');
  });

  it('lässt in „Verschieben" und „Drehen" genau einen Griff scharf', () => {
    const punkte = rechteck(30, 30);
    const v = scharfeGriffe('verschieben', punkte, 72);
    expect(scharfePunkte(punkte, v)).toEqual([punkte.mitte]);
    expect(v.kantenAus).toBe('keine');
    const d = scharfeGriffe('drehen', punkte, 72);
    expect(scharfePunkte(punkte, d)).toEqual([punkte.dreh]);
    expect(d.kantenAus).toBe('keine');
  });
});
