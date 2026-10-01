import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderMitProviders } from '../test/utils';
import DemoMarke, { DEMO_MARKE } from './DemoMarke';

/**
 * LFH-733, design.md D4: Die Marke trägt ihre Bedeutung im Wortlaut, die Farbe trägt nichts
 * (WCAG 1.4.1). `neutral` in der Rand-Form, weil Herkunft kein Warnzustand ist.
 */
describe('DemoMarke', () => {
  it('zeigt „Demo“ als Wortlaut, neutral und in der Rand-Form', () => {
    renderMitProviders(<DemoMarke />);
    const tag = screen.getByText('Demo').closest('.ant-tag') as HTMLElement;
    expect(tag).toBeVisible();
    expect(tag.dataset.rolle).toBe('neutral');
    expect(tag.dataset.darstellung).toBe('rand');
    expect(DEMO_MARKE).toEqual({ rolle: 'neutral', label: 'Demo' });
  });

  it('erklärt die Herkunft im Titel', () => {
    renderMitProviders(<DemoMarke />);
    expect(screen.getByText('Demo').closest('.ant-tag')).toHaveAttribute(
      'title',
      'Angelegt vom Demo-Import',
    );
  });
});
