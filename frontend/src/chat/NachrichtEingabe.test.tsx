import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderMitProviders } from '../test/utils';
import NachrichtEingabe from './NachrichtEingabe';

describe('NachrichtEingabe', () => {
  it('sendet getrimmten Text und leert das Feld', async () => {
    const onSenden = vi.fn();
    renderMitProviders(<NachrichtEingabe onSenden={onSenden} senden={false} />);
    const feld = screen.getByPlaceholderText('Nachricht…');
    await userEvent.type(feld, '  Lagebild aktualisiert  ');
    await userEvent.click(screen.getByRole('button', { name: 'Senden' }));
    expect(onSenden).toHaveBeenCalledWith('Lagebild aktualisiert');
  });

  it('sendet nicht bei leerem Text', async () => {
    const onSenden = vi.fn();
    renderMitProviders(<NachrichtEingabe onSenden={onSenden} senden={false} />);
    await userEvent.click(screen.getByRole('button', { name: 'Senden' }));
    expect(onSenden).not.toHaveBeenCalled();
  });
});
