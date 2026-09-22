import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import KommKarte from './KommKarte';

const karte = (c: HTMLElement) => c.querySelector<HTMLElement>('[data-lfh="komm-karte"]')!;

describe('KommKarte — Kartenrand-Vertrag (LFH-343 · C8, H47)', () => {
  it('trägt Alarm als data-alarm und NICHT zusätzlich den Eingangszustand', () => {
    const { container } = render(
      <KommKarte alarm unbearbeitet>
        Inhalt
      </KommKarte>,
    );
    expect(karte(container)).toHaveAttribute('data-alarm', 'true');
    expect(karte(container)).not.toHaveAttribute('data-unbearbeitet');
  });

  it('trägt den Eingangszustand, wenn kein Alarm besteht', () => {
    const { container } = render(<KommKarte unbearbeitet>Inhalt</KommKarte>);
    expect(karte(container)).toHaveAttribute('data-unbearbeitet', 'true');
    expect(karte(container)).not.toHaveAttribute('data-alarm');
  });

  it('zeigt Zeit und Nummer in der Zeitspalte und reicht data-Attribute durch', () => {
    const { container } = render(
      <KommKarte data-meldung-id={5} zeit="14:02" nr="#12">
        Inhalt
      </KommKarte>,
    );
    expect(karte(container)).toHaveAttribute('data-meldung-id', '5');
    const spalte = container.querySelector('[data-lfh="komm-karte-zeit"]')!;
    expect(spalte).toHaveTextContent('14:02');
    expect(spalte).toHaveTextContent('#12');
    expect(screen.getByText('Inhalt')).toBeInTheDocument();
  });

  it('lässt die Zeitspalte ohne `zeit` ganz weg', () => {
    const { container } = render(<KommKarte>Inhalt</KommKarte>);
    expect(container.querySelector('[data-lfh="komm-karte-zeit"]')).toBeNull();
  });
});
