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

  it('geschlossen: zeigt Label+Wert, × ruft onRemove (nicht onEdit)', async () => {
    const onRemove = vi.fn();
    const onEdit = vi.fn();
    renderMitProviders(
      <MetaChip feld="meldeweg" editing={false} wert="funk" onCommit={vi.fn()} onCancel={vi.fn()} onRemove={onRemove} onEdit={onEdit} />,
    );
    expect(screen.getByText(/Meldeweg/)).toBeInTheDocument();
    expect(screen.getByText(/Funk/)).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('schließen'));
    expect(onRemove).toHaveBeenCalledWith('meldeweg');
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('Escape im Editor ruft onCancel', async () => {
    const onCancel = vi.fn();
    renderMitProviders(
      <MetaChip feld="von" editing wert={undefined} onCommit={vi.fn()} onCancel={onCancel} onRemove={vi.fn()} onEdit={vi.fn()} />,
    );
    await userEvent.type(screen.getByLabelText('Von'), '{Escape}');
    expect(onCancel).toHaveBeenCalledWith('von');
  });

  it('Text-Feld mit Optionen: AutoComplete, Freitext bleibt per Enter möglich', async () => {
    const onCommit = vi.fn();
    renderMitProviders(
      <MetaChip
        feld="von"
        editing
        wert={undefined}
        optionen={['Florian 1', 'RTW 1']}
        onCommit={onCommit}
        onCancel={vi.fn()}
        onRemove={vi.fn()}
        onEdit={vi.fn()}
      />,
    );
    const input = screen.getByRole('combobox', { name: 'Von' });
    await userEvent.type(input, 'Eigener Text{Enter}');
    expect(onCommit).toHaveBeenCalledWith('von', 'Eigener Text');
  });

  it('Text-Feld mit Optionen: Klick auf Vorschlag committet sofort (onSelect)', async () => {
    const onCommit = vi.fn();
    renderMitProviders(
      <MetaChip
        feld="von"
        editing
        wert={undefined}
        optionen={['Florian 1', 'RTW 1']}
        onCommit={onCommit}
        onCancel={vi.fn()}
        onRemove={vi.fn()}
        onEdit={vi.fn()}
      />,
    );
    const input = screen.getByRole('combobox', { name: 'Von' });
    await userEvent.type(input, 'Florian');
    // Der echte klickbare Eintrag ist `.ant-select-item-option` (der role="option"-Knoten
    // ist nur das a11y-Spiegelelement und reagiert nicht auf Klicks).
    const eintrag = await screen.findByText(
      (_, el) => typeof el?.className === 'string'
        && el.className.includes('ant-select-item-option-content')
        && el.textContent === 'Florian 1',
    );
    await userEvent.click(eintrag);
    expect(onCommit).toHaveBeenCalledWith('von', 'Florian 1');
  });
});
