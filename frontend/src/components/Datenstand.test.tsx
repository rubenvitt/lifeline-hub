import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderMitProviders } from '../test/utils';
import Datenstand, { formatiereDatenstand, gemeinsamerDatenstand } from './Datenstand';

describe('Datenstand', () => {
  it('formatiert dataUpdatedAt als lokale Stunde und Minute', () => {
    const zeit = new Date(2026, 5, 10, 14, 7, 0).getTime();
    expect(formatiereDatenstand(zeit)).toBe('14:07');
    renderMitProviders(<Datenstand dataUpdatedAt={zeit} />);
    expect(screen.getByText('Stand 14:07')).toHaveAccessibleName('Datenstand 14:07');
  });

  it('rendert vor dem ersten erfolgreichen Abruf nichts', () => {
    renderMitProviders(<Datenstand dataUpdatedAt={0} />);
    expect(screen.queryByText(/^Stand /)).not.toBeInTheDocument();
  });

  it('nimmt bei zusammengesetzten Ansichten den ältesten geladenen Teil', () => {
    expect(gemeinsamerDatenstand(300, undefined, 100, 200)).toBe(100);
    expect(gemeinsamerDatenstand(0, undefined)).toBe(0);
  });
});
