import { describe, it, expect } from 'vitest';
import { theme } from 'antd';
import {
  GRIFF_BODEN,
  GRIFF_KERN,
  griffHinweis,
  griffKante,
  griffStil,
  griffeFuerModus,
  type GriffArt,
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
});
