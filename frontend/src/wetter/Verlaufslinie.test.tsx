import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import Verlaufslinie, { MIN_SPANNE_CM, verlaufsAussage, verlaufsPfad } from './Verlaufslinie';

/** 14:05 Berliner Sommerzeit = 12:05 UTC. */
const ENDE = '2026-09-22T14:05:00+02:00';

const punkt = (minutenVorEnde: number, cm: number) => ({
  zeitpunkt: new Date(Date.parse(ENDE) - minutenVorEnde * 60_000).toISOString(),
  wasserstand_cm: cm,
});

describe('verlaufsPfad (reine Geometrie)', () => {
  it('legt drei Punkte über ein festes 24-h-Fenster, das am jüngsten Punkt endet', () => {
    const g = verlaufsPfad([punkt(1440, 600), punkt(720, 650), punkt(0, 700)], 240, 60);
    expect(g).not.toBeNull();
    // Links (−24 h) der tiefste, rechts (jetzt) der höchste Wert — y wächst nach unten.
    expect(g!.punkte[0].x).toBeCloseTo(0);
    expect(g!.punkte[1].x).toBeCloseTo(120);
    expect(g!.punkte[2].x).toBeCloseTo(240);
    expect(g!.punkte[0].y).toBeGreaterThan(g!.punkte[2].y);
    expect(g!.d.startsWith('M')).toBe(true);
    expect(g!.d.match(/L/g)).toHaveLength(2);
    expect(g!.letzter).toEqual({ x: g!.punkte[2].x, y: g!.punkte[2].y });
    expect(g!.minCm).toBe(600);
    expect(g!.maxCm).toBe(700);
  });

  it('eine kurze Reihe (3 h) steht ehrlich am rechten Rand, nicht über die ganze Breite gedehnt', () => {
    const g = verlaufsPfad([punkt(180, 600), punkt(0, 610)], 240, 60)!;
    expect(g.punkte[0].x).toBeCloseTo(210);
    expect(g.punkte[1].x).toBeCloseTo(240);
  });

  it('eine waagerechte Reihe teilt nicht durch 0 und liegt in der Mitte', () => {
    const g = verlaufsPfad([punkt(60, 500), punkt(0, 500)], 240, 60)!;
    for (const p of g.punkte) {
      expect(Number.isFinite(p.y)).toBe(true);
      expect(p.y).toBeCloseTo(30);
    }
  });

  it('kleine Schwankungen werden nicht zur vollen Höhe aufgeblasen (Mindestspanne)', () => {
    const g = verlaufsPfad([punkt(60, 500), punkt(0, 501)], 240, 60)!;
    const hub = Math.abs(g.punkte[0].y - g.punkte[1].y);
    expect(hub).toBeLessThan((60 * 1) / MIN_SPANNE_CM + 0.001);
  });

  it('ein einzelner Punkt ist ein Pfad ohne Linie, aber mit Marke', () => {
    const g = verlaufsPfad([punkt(0, 500)], 240, 60)!;
    expect(g.d).toMatch(/^M[\d.]+ [\d.]+$/);
    expect(g.letzter.x).toBeCloseTo(240);
  });

  it('ein Zusatzwert (Prognose) zieht die Spanne mit, damit die Hilfslinie im Bild liegt', () => {
    const g = verlaufsPfad([punkt(60, 600), punkt(0, 610)], 240, 60, 700)!;
    const y = g.yFuer(700);
    expect(y).toBeGreaterThanOrEqual(0);
    expect(y).toBeLessThanOrEqual(60);
    // min/max beschriften die MESSREIHE, nicht die Prognose.
    expect(g.maxCm).toBe(610);
  });

  it('leer oder ohne lesbaren Zeitpunkt → null', () => {
    expect(verlaufsPfad([], 240, 60)).toBeNull();
    expect(verlaufsPfad([{ zeitpunkt: 'kaputt', wasserstand_cm: 1 }], 240, 60)).toBeNull();
  });
});

describe('verlaufsAussage', () => {
  it('trägt Spanne und Richtung in Worten', () => {
    expect(verlaufsAussage(562, 684, 'steigend')).toBe(
      'Verlauf 24 h: 5,62 m bis 6,84 m, zuletzt steigend',
    );
    expect(verlaufsAussage(562, 684, null)).toBe('Verlauf 24 h: 5,62 m bis 6,84 m');
  });
});

describe('<Verlaufslinie>', () => {
  const reihe = [punkt(1440, 562), punkt(720, 600), punkt(0, 684)];

  it('ist ein Bild mit der Aussage als Namen; min und max stehen als Text', () => {
    render(<Verlaufslinie punkte={reihe} richtung="steigend" />);
    const bild = screen.getByRole('img', { name: 'Verlauf 24 h: 5,62 m bis 6,84 m, zuletzt steigend' });
    expect(bild.tagName.toLowerCase()).toBe('svg');
    expect(screen.getByText('6,84 m')).toBeInTheDocument();
    expect(screen.getByText('5,62 m')).toBeInTheDocument();
    expect(screen.getByText('−24 h')).toBeInTheDocument();
  });

  it('die Prognose-Hilfslinie erscheint nur mit Prognosewert', () => {
    const { container, rerender } = render(<Verlaufslinie punkte={reihe} richtung={null} />);
    expect(container.querySelector('[data-lfh="verlauf-prognose"]')).toBeNull();
    rerender(<Verlaufslinie punkte={reihe} richtung={null} prognoseCm={710} />);
    expect(container.querySelector('[data-lfh="verlauf-prognose"]')).not.toBeNull();
    expect(screen.getByText('Prognose 7,10 m')).toBeInTheDocument();
  });

  it('keine Farbe als einziger Träger: die Linie trägt Textfarbe, keine Status-Rolle', () => {
    const { container } = render(<Verlaufslinie punkte={reihe} richtung="steigend" />);
    const linie = container.querySelector('[data-lfh="verlauf-linie"]')!;
    expect(linie.getAttribute('stroke-width')).toBe('2');
    expect(linie.getAttribute('data-farbe')).toBe('text');
  });

  it('ohne Punkte rendert sie nichts', () => {
    const { container } = render(<Verlaufslinie punkte={[]} richtung={null} />);
    expect(container.firstChild).toBeNull();
  });
});
