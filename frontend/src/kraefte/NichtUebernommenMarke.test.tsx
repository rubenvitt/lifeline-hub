import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { uebernahmeOffen } from '../theme/statusFarben';
import NichtUebernommenMarke, { UnangemeldetMarke } from './NichtUebernommenMarke';

describe('NichtUebernommenMarke (LLH-1075, design.md D14)', () => {
  it('ist das Wort „nicht übernommen“ in der Rolle „achtung“', () => {
    render(<NichtUebernommenMarke />);
    const marke = screen.getByText('nicht übernommen');
    expect(marke.closest('[data-lfh="status"]')).toHaveAttribute('data-ton', 'achtung');
    expect(marke.closest('[data-lfh="nicht-uebernommen"]')).not.toBeNull();
  });

  it('blinkt nicht', () => {
    render(<NichtUebernommenMarke />);
    const tag = screen
      .getByText('nicht übernommen')
      .closest('[data-lfh="status"], [data-marke]') as HTMLElement;
    expect(tag.style.animation).toBe('');
    expect(tag.className).not.toMatch(/blink|pulse|puls/i);
  });

  it('der Vertrag trägt die Darstellung', () => {
    expect(uebernahmeOffen).toEqual({ rolle: 'achtung', label: 'nicht übernommen' });
  });
});

describe('UnangemeldetMarke', () => {
  it('nennt die Herkunft neutral, ohne Statusrolle', () => {
    render(<UnangemeldetMarke />);
    const tag = screen
      .getByText('unangemeldet')
      .closest('[data-lfh="status"], [data-marke]') as HTMLElement;
    expect(tag).not.toHaveAttribute('data-ton');
    expect(tag.className).not.toMatch(/ant-tag-(?!borderless)[a-z]+$/);
  });
});
