import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderMitProviders } from '../test/utils';
import StatusWahl from './StatusWahl';

/**
 * Overlays in Zeilen erst bei Bedarf (LLH-1974): die Statuswahl hängt ihr `Dropdown` erst beim
 * ersten Öffnen ein. Der Spy um antds echtes `Dropdown` zählt, ob es eingehängt wurde.
 */
const dropdown = vi.hoisted(() => ({ aufrufe: 0 }));
vi.mock('antd', async (original) => {
  const antd = await original<typeof import('antd')>();
  const Echt = antd.Dropdown;
  function DropdownSpy(props: React.ComponentProps<typeof Echt>) {
    dropdown.aufrufe += 1;
    return <Echt {...props} />;
  }
  return { ...antd, Dropdown: Object.assign(DropdownSpy, Echt) };
});

const OPTIONEN = [
  { wert: 1, label: 'frei' },
  { wert: 2, label: 'im Einsatz' },
];
const KNOPF = /Status von Florian 1 ändern/;

function aufbauen() {
  renderMitProviders(
    <StatusWahl<number>
      optionen={OPTIONEN}
      aktuell={1}
      kennung="Florian 1"
      onWaehlen={vi.fn()}
      darfSchreiben
    />,
  );
}

function offenesMenue(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('.ant-dropdown')]
    .filter((d) => !d.classList.contains('ant-dropdown-hidden') && d.style.pointerEvents !== 'none')
    .map((d) => d.querySelector<HTMLElement>('[role="menu"]'))
    .filter((m): m is HTMLElement => m != null);
}

describe('StatusWahl · Menü erst bei Bedarf (LLH-1974)', () => {
  it('hängt geschlossen kein Dropdown ein', () => {
    dropdown.aufrufe = 0;
    aufbauen();
    expect(dropdown.aufrufe).toBe(0);
    expect(screen.getByRole('button', { name: KNOPF })).toBeInTheDocument();
  });

  it('öffnet beim ersten Klick das Menü', async () => {
    aufbauen();
    await userEvent.click(screen.getByRole('button', { name: KNOPF }));
    await waitFor(() => expect(offenesMenue()).toHaveLength(1));
  });

  it('öffnet per Enter und gibt den Fokus nach Escape an den Knopf zurück', async () => {
    aufbauen();
    screen.getByRole('button', { name: KNOPF }).focus();
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(offenesMenue()).toHaveLength(1));
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(offenesMenue()).toHaveLength(0));
    await waitFor(() => expect(screen.getByRole('button', { name: KNOPF })).toHaveFocus());
  });
});
