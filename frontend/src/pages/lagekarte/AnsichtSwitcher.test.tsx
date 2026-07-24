import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { KartenAnsicht } from '../../api/types';
import AnsichtSwitcher from './AnsichtSwitcher';

function ansicht(over: Partial<KartenAnsicht>): KartenAnsicht {
  return {
    id: 1,
    einsatz_id: 5,
    name: 'Standard',
    reihenfolge: 0,
    ist_standard: true,
    erstellt_at: '',
    geaendert_at: '',
    ...over,
  } as KartenAnsicht;
}

const ANSICHTEN = [
  ansicht({ id: 1, name: 'Gesamtlage', ist_standard: true }),
  ansicht({ id: 2, name: 'Abschnitt Nord', ist_standard: false }),
];

function baue(over: Partial<React.ComponentProps<typeof AnsichtSwitcher>> = {}) {
  const props = {
    ansichten: ANSICHTEN,
    aktiveAnsichtId: 2,
    darfSchreiben: true,
    onWaehlen: vi.fn(),
    onNeu: vi.fn(),
    onUmbenennen: vi.fn(),
    onStandard: vi.fn(),
    onLoeschen: vi.fn(),
    ...over,
  };
  render(<AnsichtSwitcher {...props} />);
  return props;
}

describe('AnsichtSwitcher', () => {
  it('zeigt die aktive Ansicht', () => {
    baue({ aktiveAnsichtId: 2 });
    expect(screen.getByText('Abschnitt Nord')).toBeInTheDocument();
  });

  it('„Neue Ansicht" öffnet den Namensdialog und ruft onNeu mit dem Namen', async () => {
    const user = userEvent.setup();
    const props = baue();
    await user.click(screen.getByLabelText('Ansichts-Aktionen'));
    await user.click(await screen.findByText('Neue Ansicht …'));
    const input = await screen.findByLabelText('Ansichts-Name');
    await user.type(input, 'Gefahrstoff');
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(props.onNeu).toHaveBeenCalledWith('Gefahrstoff');
  });

  it('Löschen ist bei einer Standardansicht gesperrt', async () => {
    const user = userEvent.setup();
    const props = baue({ aktiveAnsichtId: 1 }); // die Standardansicht ist aktiv
    await user.click(screen.getByLabelText('Ansichts-Aktionen'));
    const loeschen = await screen.findByRole('menuitem', { name: /Löschen/ });
    // antd markiert disabled-Items via aria-disabled
    expect(loeschen).toHaveAttribute('aria-disabled', 'true');
    // Ein Klick darf nichts auslösen.
    await user.click(loeschen);
    expect(props.onLoeschen).not.toHaveBeenCalled();
  });

  it('ohne Schreibrecht gibt es kein Aktions-Menü', () => {
    baue({ darfSchreiben: false });
    expect(screen.queryByLabelText('Ansichts-Aktionen')).not.toBeInTheDocument();
  });
});
