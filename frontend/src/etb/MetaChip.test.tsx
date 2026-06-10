import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderMitProviders } from '../test/utils';
import MetaChip from './MetaChip';

describe('MetaChip', () => {
  it('Text-Feld: Editor offen, Enter committet den Wert', async () => {
    const onCommit = vi.fn();
    renderMitProviders(
      <MetaChip feld="von" editing wert={undefined} onCommit={onCommit} onCancel={vi.fn()} onRemove={vi.fn()} onEdit={vi.fn()} />,
    );
    const input = screen.getByLabelText('Von');
    await userEvent.type(input, 'ELW 1{Enter}');
    expect(onCommit).toHaveBeenCalledWith('von', 'ELW 1');
  });

  it('geschlossen: zeigt Label+Wert, × ruft onRemove', async () => {
    const onRemove = vi.fn();
    renderMitProviders(
      <MetaChip feld="meldeweg" editing={false} wert="funk" onCommit={vi.fn()} onCancel={vi.fn()} onRemove={onRemove} onEdit={vi.fn()} />,
    );
    expect(screen.getByText(/Meldeweg/)).toBeInTheDocument();
    expect(screen.getByText(/Funk/)).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('schließen'));
    expect(onRemove).toHaveBeenCalledWith('meldeweg');
  });

  it('Escape im Editor ruft onCancel', async () => {
    const onCancel = vi.fn();
    renderMitProviders(
      <MetaChip feld="von" editing wert={undefined} onCommit={vi.fn()} onCancel={onCancel} onRemove={vi.fn()} onEdit={vi.fn()} />,
    );
    await userEvent.type(screen.getByLabelText('Von'), '{Escape}');
    expect(onCancel).toHaveBeenCalledWith('von');
  });
});
