import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderMitProviders } from '../test/utils';
import IconRail from './IconRail';
import { kategorien } from './modulRegistry';

describe('IconRail', () => {
  it('rendert je Kategorie einen Button mit Label als aria-label', () => {
    renderMitProviders(
      <IconRail kategorien={kategorien} aktiveKategorie={null} onKategorieKlick={() => {}} />,
    );
    for (const k of kategorien) {
      expect(screen.getByRole('button', { name: k.label })).toBeInTheDocument();
    }
  });

  it('markiert die aktive Kategorie via aria-current', () => {
    renderMitProviders(
      <IconRail kategorien={kategorien} aktiveKategorie="lage" onKategorieKlick={() => {}} />,
    );
    expect(screen.getByRole('button', { name: 'Lage' })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('button', { name: 'Führung' })).not.toHaveAttribute('aria-current');
  });

  it('meldet Klick mit dem Kategorie-Key', async () => {
    const onKlick = vi.fn();
    renderMitProviders(
      <IconRail kategorien={kategorien} aktiveKategorie={null} onKategorieKlick={onKlick} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Erfassung' }));
    expect(onKlick).toHaveBeenCalledWith('erfassung');
  });
});
