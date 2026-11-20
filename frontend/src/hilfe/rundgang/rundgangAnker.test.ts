import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { istSichtbar, loeseSchritteAuf } from './rundgangAnker';
import { RUNDGANG_SCHRITTE, type RundgangSchritt } from './rundgangTexte';

/** jsdom kennt kein Layout: sichtbar ist, was nicht `data-unsichtbar` trägt. */
beforeEach(() => {
  vi.spyOn(Element.prototype, 'getClientRects').mockImplementation(function (this: Element) {
    const leer = this.closest('[data-unsichtbar]') !== null;
    return { length: leer ? 0 : 1 } as unknown as DOMRectList;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

function dom(html: string) {
  document.body.innerHTML = html;
}

const MODULE = RUNDGANG_SCHRITTE.einsatz.find((s) => s.id === 'module')!;

describe('Anker des Rundgangs (LLH-1990)', () => {
  it('ein Schritt ohne Ziel entfällt; ohne jedes Ziel bleibt nichts', () => {
    const schritte: RundgangSchritt[] = [
      { id: 'a', titel: 'A', varianten: [{ anker: '[data-lfh="a"]', text: 'a' }] },
      { id: 'b', titel: 'B', varianten: [{ anker: '[data-lfh="b"]', text: 'b' }] },
    ];
    dom('<div data-lfh="b"></div>');
    expect(loeseSchritteAuf(schritte).map((s) => s.schritt.id)).toEqual(['b']);
    dom('');
    expect(loeseSchritteAuf(schritte)).toEqual([]);
  });

  it('Module: Paneel vor Leiste vor Navigations-Öffner', () => {
    dom(
      '<div data-lfh="modul-panel"></div><div data-lfh="rail-spalte"></div><button data-lfh="navigation-oeffnen"></button>',
    );
    const [paneel] = loeseSchritteAuf([MODULE]);
    expect(paneel.ziel.dataset.lfh).toBe('modul-panel');
    expect(paneel.text).toBe(MODULE.varianten[0].text);

    dom('<div data-lfh="rail-spalte"></div>');
    const [leiste] = loeseSchritteAuf([MODULE]);
    expect(leiste.ziel.dataset.lfh).toBe('rail-spalte');
    expect(leiste.text).toBe(MODULE.varianten[1].text);

    dom('<button data-lfh="navigation-oeffnen"></button>');
    expect(loeseSchritteAuf([MODULE])[0].ziel.dataset.lfh).toBe('navigation-oeffnen');
  });

  it('nimmt das erste sichtbare von mehreren Zielen', () => {
    dom(
      '<div data-unsichtbar><button data-lfh="suche-ausloeser" id="weg"></button></div><button data-lfh="suche-ausloeser" id="da"></button>',
    );
    const suche = RUNDGANG_SCHRITTE.liste.find((s) => s.id === 'suche')!;
    expect(loeseSchritteAuf([suche])[0].ziel.id).toBe('da');
  });

  it('ein Vorfahr mit visibility: hidden macht unsichtbar', () => {
    dom('<div style="visibility: hidden"><span id="x"></span></div><span id="y"></span>');
    expect(istSichtbar(document.getElementById('x')!)).toBe(false);
    expect(istSichtbar(document.getElementById('y')!)).toBe(true);
  });

  it('jeder Schritt hat Titel, Varianten und keine Anrede', () => {
    for (const teil of ['liste', 'einsatz'] as const) {
      expect(RUNDGANG_SCHRITTE[teil].length).toBeGreaterThan(0);
      for (const s of RUNDGANG_SCHRITTE[teil]) {
        expect(s.titel, s.id).not.toBe('');
        expect(s.varianten.length, s.id).toBeGreaterThan(0);
        for (const v of s.varianten)
          expect(v.text, s.id).not.toMatch(/\b(du|dich|dir|dein\w*|Sie|Ihnen|Ihr\w*)\b/);
      }
    }
  });
});
