import { describe, it, expect, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderMitProviders } from '../../test/utils';
import type { FreiesZeichen } from '../../api/types';
import FreiesZeichenInspector, { type FreiesZeichenInspectorProps } from './FreiesZeichenInspector';

const basis: FreiesZeichen = {
  id: 42,
  einsatz_id: 1,
  lat: 50.1,
  lon: 8.6,
  grundzeichen: 'taktische-formation',
  organisation: 'feuerwehr',
  fachaufgabe: 'brandbekaempfung',
  symbol: null,
  einheit: 'zug',
  funktion: null,
  farbe: '#ff0000',
  label: 'Zug 1',
  erstellt_von: 1,
  erstellt_at: '',
  geaendert_at: '',
};

function renderInspector(
  opts: {
    zeichen?: FreiesZeichen;
    darfSchreiben?: boolean;
    onAendern?: FreiesZeichenInspectorProps['onAendern'];
    onLoeschen?: FreiesZeichenInspectorProps['onLoeschen'];
  } = {},
) {
  const onAendern = opts.onAendern ?? vi.fn<FreiesZeichenInspectorProps['onAendern']>();
  const onLoeschen = opts.onLoeschen ?? vi.fn<FreiesZeichenInspectorProps['onLoeschen']>();
  renderMitProviders(
    <FreiesZeichenInspector
      zeichen={opts.zeichen ?? basis}
      darfSchreiben={opts.darfSchreiben ?? true}
      onSchliessen={() => {}}
      onAendern={onAendern}
      onLoeschen={onLoeschen}
      ansichten={[]}
      onVerschieben={() => {}}
    />,
  );
  return { onAendern, onLoeschen };
}

describe('FreiesZeichenInspector', () => {
  it('rendert mit vorbelegtem Picker (Grundzeichen des Records sichtbar)', () => {
    renderInspector();
    // Der Grundzeichen-Select zeigt das Label des Records als gewählten Wert.
    expect(screen.getByText('Taktische Formation')).toBeInTheDocument();
  });

  it('„Löschen" ruft onLoeschen', async () => {
    const { onLoeschen } = renderInspector();
    await userEvent.click(screen.getByRole('button', { name: 'Löschen' }));
    expect(onLoeschen).toHaveBeenCalled();
  });

  it('zeigt KEINEN „Im Fach-Modul öffnen"-Link', () => {
    renderInspector();
    expect(screen.queryByText(/Fach-Modul/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('meldet onAendern mit der vollständigen Spec bei einer Edit-Auswahl', async () => {
    const { onAendern } = renderInspector();
    const org = screen.getAllByLabelText('Organisation')[0];
    fireEvent.mouseDown(org.querySelector('.ant-select-selector') ?? org);
    const opt = await screen.findAllByText('THW');
    await userEvent.click(opt[opt.length - 1]);
    await waitFor(() =>
      expect(onAendern).toHaveBeenCalledWith(
        expect.objectContaining({
          grundzeichen: 'taktische-formation',
          organisation: 'thw',
          label: 'Zug 1',
        }),
      ),
    );
  });

  it('read-only (darfSchreiben=false): keine Edit-Controls, zeigt die Werte', () => {
    renderInspector({ darfSchreiben: false });
    // Keine interaktiven Selects/Buttons.
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Löschen' })).not.toBeInTheDocument();
    // Werte als Text (Grundzeichen + gesetzte Overlays).
    expect(screen.getByText('Taktische Formation')).toBeInTheDocument();
    expect(screen.getByText('Feuerwehr')).toBeInTheDocument();
  });
});
