/**
 * Rechnung der Resthöhe (LLH-1294). jsdom rechnet kein Layout: Lage und Höhen setzt der Test; das
 * gerenderte Ergebnis (kein Bildlauf bei kurzer Liste, Tastenfeld am Rand) misst
 * `e2e/verpflegung-ausgabe.spec.ts` „Höhe“ am Stab und am Gerät.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { restHoeheVon, scrollbereichVon } from './restHoehe';

function kasten(el: HTMLElement, top: number) {
  el.getBoundingClientRect = () => ({ top }) as DOMRect;
}

function setze(el: HTMLElement, feld: 'clientHeight' | 'clientTop' | 'scrollTop', wert: number) {
  Object.defineProperty(el, feld, { configurable: true, value: wert });
}

afterEach(() => {
  document.body.innerHTML = '';
  window.scrollY = 0;
});

describe('restHoehe', () => {
  it('ohne rollenden Vorfahren rollt das Dokument: 100dvh minus Lage im Dokument, Polsterung aufgehoben', () => {
    document.body.innerHTML = '<div><div id="ziel"></div></div>';
    const ziel = document.getElementById('ziel')!;
    expect(scrollbereichVon(ziel)).toBeNull();
    kasten(ziel, 40);
    window.scrollY = 120;
    // Die Lage zählt im Dokument, nicht im Fenster: gerollt bleibt der Wert derselbe.
    expect(restHoeheVon(ziel)).toEqual({
      minHeight: 'calc(100dvh - 160px)',
      marginBottom: 'calc(-1 * var(--lfh-seiten-polsterung, 0px))',
      unten: 'var(--lfh-seiten-polsterung, 0px)',
    });
  });

  it('body mit `overflow-x: hidden` (überlauf-y wird `auto`) gilt weiter als Dokument', () => {
    document.body.style.overflowX = 'hidden';
    document.body.innerHTML = '<div id="ziel"></div>';
    expect(scrollbereichVon(document.getElementById('ziel')!)).toBeNull();
    document.body.style.removeProperty('overflow-x');
  });

  it('im eigenen Scrollbereich (Gerätehülle): sichtbare Höhe minus Lage darin minus Polsterung unten', () => {
    document.body.innerHTML =
      '<main id="bereich" style="overflow-y: auto; padding-bottom: 12px"><div><div id="ziel"></div></div></main>';
    const bereich = document.getElementById('bereich')!;
    const ziel = document.getElementById('ziel')!;
    expect(scrollbereichVon(ziel)).toBe(bereich);
    // Kopfzeile 56 px über dem Bereich, Bereich 560 px hoch (Navigation darunter zählt nicht),
    // Seitenkopf 70 px über dem Ziel, 30 px gerollt.
    kasten(bereich, 56);
    setze(bereich, 'clientHeight', 560);
    setze(bereich, 'clientTop', 0);
    setze(bereich, 'scrollTop', 30);
    kasten(ziel, 56 + 70 - 30);
    expect(restHoeheVon(ziel)).toEqual({
      minHeight: `${560 - 70 - 12}px`,
      marginBottom: '',
      unten: '0px',
    });
  });

  it('reicht der Bereich nicht, wird die Mindesthöhe 0 statt negativ', () => {
    document.body.innerHTML =
      '<main id="bereich" style="overflow-y: scroll"><div id="ziel"></div></main>';
    const bereich = document.getElementById('bereich')!;
    const ziel = document.getElementById('ziel')!;
    kasten(bereich, 0);
    setze(bereich, 'clientHeight', 100);
    setze(bereich, 'clientTop', 0);
    setze(bereich, 'scrollTop', 0);
    kasten(ziel, 400);
    expect(restHoeheVon(ziel).minHeight).toBe('0px');
  });
});
