import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderMitProviders } from '../test/utils';
import VollzugMeldenModal from './VollzugMeldenModal';

describe('VollzugMeldenModal — Eingabegrenze (LFH-937)', () => {
  it('zählt ab 80 %; über 20 000 Zeichen bleibt der Text stehen und Melden sperrt', async () => {
    const onBestaetigen = vi.fn();
    renderMitProviders(
      <VollzugMeldenModal offen onAbbrechen={vi.fn()} onBestaetigen={onBestaetigen} />,
    );
    const feld = screen.getByPlaceholderText('Rückmeldung zur Erledigung');
    expect(feld).not.toHaveAttribute('maxlength');
    fireEvent.change(feld, { target: { value: 'v'.repeat(16_000) } });
    expect(screen.getByText('16.000 / 20.000')).toBeInTheDocument();
    fireEvent.change(feld, { target: { value: 'v'.repeat(20_001) } });
    expect(screen.getByText('20.001 / 20.000 · zu lang')).toBeInTheDocument();
    const melden = screen.getByRole('button', { name: 'Vollzug melden' });
    expect(melden).toBeDisabled();
    await userEvent.click(melden);
    expect(onBestaetigen).not.toHaveBeenCalled();
    expect(feld).toHaveValue('v'.repeat(20_001));
  });
});
