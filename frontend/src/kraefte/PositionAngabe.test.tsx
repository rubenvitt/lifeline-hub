import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderMitProviders } from '../test/utils';
import { waehle } from '../test/auswahlListe';
import PositionAngabe, { type PositionAngabeProps } from './PositionAngabe';

function angabe(p: Partial<PositionAngabeProps> = {}) {
  const onSpeichern = p.onSpeichern ?? vi.fn().mockResolvedValue(undefined);
  renderMitProviders(
    <PositionAngabe kennung="Anna" wert={null} darfSchreiben {...p} onSpeichern={onSpeichern} />,
  );
  return onSpeichern;
}

describe('PositionAngabe (LLH-1060)', () => {
  it('zeigt das Kürzel mit dem Wort als Titel', () => {
    angabe({ wert: 'unterfuehrer' });
    const knopf = screen.getByRole('button', { name: 'Position zu Anna bearbeiten' });
    expect(knopf).toHaveTextContent('UF');
    expect(screen.getByTitle('Unterführer')).toHaveTextContent('UF');
  });

  it('ausgeschrieben in der Ansicht', () => {
    angabe({ wert: 'fuehrer', ausgeschrieben: true, darfSchreiben: false });
    expect(screen.getByText('Führer')).toBeVisible();
  });

  it('wählen, dann speichern: genau die Position', async () => {
    const onSpeichern = angabe({ wert: 'mannschaft' });
    await userEvent.click(screen.getByRole('button', { name: 'Position zu Anna bearbeiten' }));
    await waehle('Position zu Anna', 'Führer');
    expect(onSpeichern).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Position zu Anna speichern' }));
    await waitFor(() => expect(onSpeichern).toHaveBeenCalledWith('fuehrer'));
  });

  it('Leeren sendet null', async () => {
    const onSpeichern = angabe({ wert: 'fuehrer' });
    await userEvent.click(screen.getByRole('button', { name: 'Position zu Anna bearbeiten' }));
    const feld = screen.getByRole('combobox', { name: 'Position zu Anna' }).closest('.ant-select')!;
    await userEvent.click(feld.querySelector<HTMLElement>('.ant-select-clear')!);
    await userEvent.click(screen.getByRole('button', { name: 'Position zu Anna speichern' }));
    await waitFor(() => expect(onSpeichern).toHaveBeenCalledWith(null));
  });

  it('ohne Schreibrecht: Kürzel als Text', () => {
    angabe({ wert: 'mannschaft', darfSchreiben: false });
    expect(screen.getByText('M')).toBeVisible();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
