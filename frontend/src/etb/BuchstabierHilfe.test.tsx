import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderMitProviders } from '../test/utils';
import BuchstabierHilfe from './BuchstabierHilfe';

describe('BuchstabierHilfe', () => {
  it('zeigt die klassische Buchstabierung erst nach Klick auf den Trigger', async () => {
    renderMitProviders(<BuchstabierHilfe text="Florian" />);
    // Vor dem Klick ist der Popover-Inhalt nicht sichtbar.
    expect(screen.queryByText('Friedrich')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Buchstabierhilfe' }));
    expect(await screen.findByText('Friedrich')).toBeInTheDocument();
    expect(screen.getByText('Ludwig')).toBeInTheDocument();
  });

  it('schaltet auf NATO um', async () => {
    renderMitProviders(<BuchstabierHilfe text="AB" />);
    await userEvent.click(screen.getByRole('button', { name: 'Buchstabierhilfe' }));
    expect(await screen.findByText('Anton')).toBeInTheDocument();
    await userEvent.click(screen.getByText('NATO'));
    expect(await screen.findByText('Alfa')).toBeInTheDocument();
    expect(screen.queryByText('Anton')).not.toBeInTheDocument();
  });

  it('weist bei leerem Text auf die Eingabe hin', async () => {
    renderMitProviders(<BuchstabierHilfe text="" />);
    await userEvent.click(screen.getByRole('button', { name: 'Buchstabierhilfe' }));
    expect(await screen.findByText(/Text im Feld eingeben/)).toBeInTheDocument();
  });
});
