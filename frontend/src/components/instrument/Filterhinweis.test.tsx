import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderMitProviders } from '../../test/utils';
import { farbenHell } from '../../theme/tokens';
import Filterhinweis from './Filterhinweis';

describe('Filterhinweis (LLH-1071)', () => {
  it('nennt „Gefiltert“, wie viel sichtbar ist, und die Merkmale', () => {
    renderMitProviders(
      <Filterhinweis
        treffer={7}
        gesamt={134}
        merkmale={['Meldung', 'seit 1345', 'ohne System']}
        onZuruecksetzen={vi.fn()}
      />,
    );
    const band = screen.getByRole('status');
    expect(band).toHaveTextContent('Gefiltert');
    expect(band).toHaveTextContent('7 von 134 Einträgen sichtbar');
    expect(band).toHaveTextContent('Meldung · seit 1345 · ohne System');
  });

  it('nennt ohne Zählung keine Zahl', () => {
    renderMitProviders(
      <Filterhinweis treffer={7} merkmale={['Meldung']} onZuruecksetzen={vi.fn()} />,
    );
    const band = screen.getByRole('status');
    expect(band).toHaveTextContent('Gefiltert');
    expect(band).not.toHaveTextContent(/\d/);
  });

  it('trägt die Merkmale vollständig im Titel, falls sie gekürzt werden', () => {
    renderMitProviders(
      <Filterhinweis merkmale={['Meldung', '„Deich“']} onZuruecksetzen={vi.fn()} />,
    );
    expect(screen.getByTitle('Meldung · „Deich“')).toBeInTheDocument();
  });

  it('„Filter zurücksetzen“ ruft den Aufrufer', async () => {
    const onZuruecksetzen = vi.fn();
    renderMitProviders(<Filterhinweis merkmale={['Meldung']} onZuruecksetzen={onZuruecksetzen} />);
    await userEvent.click(screen.getByRole('button', { name: 'Filter zurücksetzen' }));
    expect(onZuruecksetzen).toHaveBeenCalledTimes(1);
  });

  it('zeigt Zusatzzeilen unter dem Band', () => {
    renderMitProviders(
      <Filterhinweis
        merkmale={['Meldung']}
        onZuruecksetzen={vi.fn()}
        zusaetze={[<span key="a">Nr. 135 erfasst – außerhalb des Filters</span>]}
      />,
    );
    expect(screen.getByText('Nr. 135 erfasst – außerhalb des Filters')).toBeInTheDocument();
  });

  it('steht ohne Merkmal nicht da', () => {
    renderMitProviders(<Filterhinweis merkmale={[]} onZuruecksetzen={vi.fn()} />);
    expect(screen.queryByRole('status')).toBeNull();
    expect(document.querySelector('[data-lfh="filterhinweis"]')).toBeNull();
  });

  it('nimmt Fläche, Kante und Text aus der Achtungsrolle', () => {
    renderMitProviders(<Filterhinweis merkmale={['Meldung']} onZuruecksetzen={vi.fn()} />);
    const band = screen.getByRole('status');
    // Der Test rendert ohne Nachttheme: die Hellpalette gilt.
    expect(band.style.background).toBe(hexZuRgb(farbenHell.achtungFlaeche));
    expect(band.style.borderInlineStart).toContain(farbenHell.achtung);
    expect(band.style.color).toBe(hexZuRgb(farbenHell.achtungText));
  });
});

function hexZuRgb(hex: string): string {
  const n = Number.parseInt(hex.replace('#', ''), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}
