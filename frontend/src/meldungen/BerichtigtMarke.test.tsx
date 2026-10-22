import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import BerichtigtMarke from './BerichtigtMarke';

const geraet = vi.hoisted(() => ({ darf: true }));
vi.mock('../geraet/geraetSicht', async (importOriginal) => {
  const echt = await importOriginal<typeof import('../geraet/geraetSicht')>();
  return { ...echt, useGeraetDarf: () => () => geraet.darf };
});

function renderMarke(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

// LLH-1382, design.md D3/D4: Marke „berichtigt“ mit Sprung auf die jüngste ETB-Berichtigung.
describe('BerichtigtMarke', () => {
  beforeEach(() => {
    geraet.darf = true;
  });

  it('zeigt „berichtigt“ und springt per ?eintrag= auf die Berichtigung im ETB', () => {
    renderMarke(<BerichtigtMarke einsatzId={7} berichtigungId={41} berichtigungLfdNr={9} />);
    expect(screen.getByText('berichtigt')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Berichtigung im ETB, Nr. 9' });
    expect(link).toHaveAttribute('href', '/einsaetze/7/etb?eintrag=41');
    expect(link).toHaveTextContent('→ ETB Nr. 9');
  });

  it('rendert ohne Berichtigung nichts', () => {
    const { container } = renderMarke(<BerichtigtMarke einsatzId={7} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('zeigt sich an einem Gerät nicht: dort gibt es kein ETB', () => {
    geraet.darf = false;
    const { container } = renderMarke(
      <BerichtigtMarke einsatzId={7} berichtigungId={41} berichtigungLfdNr={9} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
