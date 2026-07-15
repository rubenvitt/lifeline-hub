import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderMitProviders } from '../test/utils';
import SegmentSektionen from './SegmentSektionen';

const SEKTIONEN = [
  { key: 'a', label: 'Alpha', inhalt: <div>Inhalt Alpha</div> },
  { key: 'b', label: 'Beta', inhalt: <div>Inhalt Beta</div> },
  { key: 'c', label: 'Gamma', inhalt: <div>Inhalt Gamma</div> },
];

describe('SegmentSektionen', () => {
  it('zeigt die erste Sektion, hält aber alle Panels gemountet (nur versteckt)', () => {
    renderMitProviders(<SegmentSektionen sektionen={SEKTIONEN} ariaLabel="Bereiche" />);
    // Alle Inhalte sind gemountet (auch die versteckten) — kritisch fürs seitenweite Speichern.
    expect(screen.getByText('Inhalt Alpha')).toBeInTheDocument();
    expect(screen.getByText('Inhalt Beta')).toBeInTheDocument();
    expect(screen.getByText('Inhalt Gamma')).toBeInTheDocument();
    // Sichtbar ist nur die erste.
    expect(screen.getByText('Inhalt Alpha')).toBeVisible();
    expect(screen.getByText('Inhalt Beta')).not.toBeVisible();
    expect(screen.getByText('Inhalt Gamma')).not.toBeVisible();
  });

  it('schaltet per Segmented-Option auf eine andere Sektion um', async () => {
    renderMitProviders(<SegmentSektionen sektionen={SEKTIONEN} ariaLabel="Bereiche" />);
    await userEvent.click(screen.getByText('Beta'));
    expect(screen.getByText('Inhalt Beta')).toBeVisible();
    expect(screen.getByText('Inhalt Alpha')).not.toBeVisible();
  });

  it('respektiert standardKey', () => {
    renderMitProviders(
      <SegmentSektionen sektionen={SEKTIONEN} ariaLabel="Bereiche" standardKey="c" />,
    );
    expect(screen.getByText('Inhalt Gamma')).toBeVisible();
    expect(screen.getByText('Inhalt Alpha')).not.toBeVisible();
  });
});
