import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { farbenDunkel } from '../theme/tokens';
import { Bildmarke } from './Bildmarke';
import { LINIE_PFAD, LINIE_STAERKE, MARKE_RAHMEN, MARKE_VIEWBOX } from './bildmarkeGeometrie';

describe('Bildmarke (LFH-837)', () => {
  it('ist Dekoration: verborgen für assistive Technik und nicht fokussierbar', () => {
    const { container } = render(<Bildmarke hoehe={22} linienFarbe="#e8ebee" />);
    const svg = container.querySelector('svg[data-lfh="bildmarke"]');
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveAttribute('focusable', 'false');
  });

  it('zeichnet die gemeinsame Geometrie in der verlangten Höhe', () => {
    const { container } = render(<Bildmarke hoehe={22} linienFarbe="#e8ebee" />);
    const svg = container.querySelector('svg')!;
    expect(svg).toHaveAttribute('viewBox', MARKE_VIEWBOX);
    expect(svg).toHaveAttribute('height', '22');
    expect(Number(svg.getAttribute('width'))).toBeCloseTo(
      (22 * MARKE_RAHMEN.breite) / MARKE_RAHMEN.hoehe,
      5,
    );
    const linie = svg.querySelector('path')!;
    expect(linie).toHaveAttribute('d', LINIE_PFAD);
    expect(linie).toHaveAttribute('stroke-width', String(LINIE_STAERKE));
  });

  it('nimmt die Linienfarbe von außen, das Quadrat bleibt in marke', () => {
    const { container } = render(<Bildmarke hoehe={20} linienFarbe="var(--lfh-text)" />);
    expect(container.querySelector('path')).toHaveAttribute('stroke', 'var(--lfh-text)');
    expect(container.querySelector('rect')).toHaveAttribute('fill', farbenDunkel.marke);
  });
});
