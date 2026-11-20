import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Input } from 'antd';
import { describe, expect, it, vi } from 'vitest';
import { renderMitProviders } from '../test/utils';
import { InlineAngabe } from './InlineAngabe';
import { AngabeFormProvider } from './angabeForm';

/**
 * Overlays in Zeilen erst bei Bedarf (LLH-1974): die schwebende Angabe hängt ihr `Popover` erst
 * beim ersten Öffnen ein. Der Spy um antds echtes `Popover` zählt, ob es eingehängt wurde.
 */
const popover = vi.hoisted(() => ({ aufrufe: 0 }));
vi.mock('antd', async (original) => {
  const antd = await original<typeof import('antd')>();
  const Echt = antd.Popover;
  function PopoverSpy(props: React.ComponentProps<typeof Echt>) {
    popover.aufrufe += 1;
    return <Echt {...props} />;
  }
  return { ...antd, Popover: PopoverSpy };
});

function Zelle() {
  return (
    <AngabeFormProvider form="schwebend">
      <InlineAngabe<string>
        etikett="Leitstellen-Nr."
        kennung="Anna"
        wert="ILS-1"
        anzeige="ILS-1"
        leer={(w) => w.trim() === ''}
        darfSchreiben
        onSpeichern={vi.fn().mockResolvedValue(undefined)}
        eingabe={({ feld, value, onChange }) => (
          <Input {...feld} value={value} onChange={(e) => onChange(e.target.value)} />
        )}
      />
    </AngabeFormProvider>
  );
}

const KNOPF = 'Leitstellen-Nr. zu Anna bearbeiten';
const FELD = 'Leitstellen-Nr. zu Anna';

describe('InlineAngabe · Popover erst bei Bedarf (LLH-1974)', () => {
  it('hängt geschlossen kein Popover ein', () => {
    popover.aufrufe = 0;
    const { container } = renderMitProviders(<Zelle />);
    expect(popover.aufrufe).toBe(0);
    expect(container.querySelector('[data-lfh="angabe-anker"]')).not.toBeNull();
  });

  it('öffnet beim ersten Klick in einem Zug', async () => {
    renderMitProviders(<Zelle />);
    await userEvent.click(screen.getByRole('button', { name: KNOPF }));
    expect(await screen.findByRole('textbox', { name: FELD })).toHaveFocus();
  });

  it('öffnet beim ersten Enter in einem Zug und gibt den Fokus nach Escape an den Knopf zurück', async () => {
    renderMitProviders(<Zelle />);
    screen.getByRole('button', { name: KNOPF }).focus();
    await userEvent.keyboard('{Enter}');
    const feld = await screen.findByRole('textbox', { name: FELD });
    await waitFor(() => expect(feld).toHaveFocus());
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('textbox', { name: FELD })).toBeNull());
    await waitFor(() => expect(screen.getByRole('button', { name: KNOPF })).toHaveFocus());
  });
});
