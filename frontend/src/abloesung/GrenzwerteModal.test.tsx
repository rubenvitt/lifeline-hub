import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { SchichtplanGrenzwerte, SchichtplanGrenzwerteBody } from '../api/types';
import { renderMitProviders } from '../test/utils';
import GrenzwerteModal from './GrenzwerteModal';

/**
 * Dialog „Dienst und Ruhe“ (LLH-1603): leeres Feld = Vorgabe, Grenzen in Dauerform, gesendet wird
 * nur, was sich geändert hat.
 */

const VORGABEN: SchichtplanGrenzwerte = {
  max_dienst_minuten: 720,
  min_ruhe_minuten: 480,
  max_dienst_eigen: false,
  min_ruhe_eigen: false,
};

function zeige(grenzwerte: SchichtplanGrenzwerte) {
  const onSpeichern = vi.fn<(b: SchichtplanGrenzwerteBody) => Promise<unknown>>(() =>
    Promise.resolve(),
  );
  const onSchliessen = vi.fn();
  renderMitProviders(
    <GrenzwerteModal
      grenzwerte={grenzwerte}
      speicherung={{ error: null, isPending: false, reset: () => {} }}
      onSpeichern={onSpeichern}
      onSchliessen={onSchliessen}
    />,
  );
  const dialog = screen.getByRole('dialog', { name: 'Dienst und Ruhe' });
  return {
    onSpeichern,
    onSchliessen,
    dialog,
    max: within(dialog).getByRole('textbox', { name: 'Höchstdienst' }),
    ruhe: within(dialog).getByRole('textbox', { name: 'Mindestruhe' }),
    speichern: within(dialog).getByRole('button', { name: 'Speichern' }),
  };
}

describe('GrenzwerteModal (LLH-1603)', () => {
  it('lässt die Felder bei der Vorgabe leer und nennt sie im Platzhalter', () => {
    const { max, ruhe } = zeige(VORGABEN);
    expect(max).toHaveValue('');
    expect(max).toHaveAttribute('placeholder', '12 h (Vorgabe)');
    expect(ruhe).toHaveValue('');
    expect(ruhe).toHaveAttribute('placeholder', '8 h (Vorgabe)');
  });

  it('belegt eigene Werte in Dauerform vor', () => {
    const { max, ruhe } = zeige({
      ...VORGABEN,
      max_dienst_minuten: 600,
      max_dienst_eigen: true,
      min_ruhe_minuten: 450,
      min_ruhe_eigen: true,
    });
    expect(max).toHaveValue('10 h');
    expect(ruhe).toHaveValue('7:30 h');
  });

  it('sendet nur das geänderte Feld', async () => {
    const { max, speichern, onSpeichern } = zeige(VORGABEN);
    await userEvent.type(max, '10 h');
    await userEvent.click(speichern);
    await waitFor(() => expect(onSpeichern).toHaveBeenCalledWith({ max_dienst_minuten: 600 }));
  });

  it('macht aus einem geleerten Feld die Vorgabe (`null`)', async () => {
    const { ruhe, speichern, onSpeichern } = zeige({
      ...VORGABEN,
      min_ruhe_minuten: 300,
      min_ruhe_eigen: true,
    });
    await userEvent.clear(ruhe);
    await userEvent.click(speichern);
    await waitFor(() => expect(onSpeichern).toHaveBeenCalledWith({ min_ruhe_minuten: null }));
  });

  it('vergleicht mit dem Stand beim Öffnen, nicht mit einem späteren Live-Stand', async () => {
    const eigen = { ...VORGABEN, max_dienst_minuten: 600, max_dienst_eigen: true };
    const onSpeichern = vi.fn<(b: SchichtplanGrenzwerteBody) => Promise<unknown>>(() =>
      Promise.resolve(),
    );
    const props = {
      speicherung: { error: null, isPending: false, reset: () => {} },
      onSpeichern,
      onSchliessen: () => {},
    };
    const { rerender } = renderMitProviders(<GrenzwerteModal grenzwerte={eigen} {...props} />);
    // Eine andere Sitzung setzt inzwischen 11 h; der Refetch reicht den neuen Stand herein.
    rerender(<GrenzwerteModal grenzwerte={{ ...eigen, max_dienst_minuten: 660 }} {...props} />);
    const dialog = screen.getByRole('dialog', { name: 'Dienst und Ruhe' });
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Mindestruhe' }), '6 h');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(onSpeichern).toHaveBeenCalledWith({ min_ruhe_minuten: 360 }));
  });

  it('schließt ohne Aufruf, wenn sich nichts ändert', async () => {
    const { speichern, onSpeichern, onSchliessen } = zeige(VORGABEN);
    await userEvent.click(speichern);
    await waitFor(() => expect(onSchliessen).toHaveBeenCalled());
    expect(onSpeichern).not.toHaveBeenCalled();
  });

  it('nennt die Grenzen in Dauerform und speichert nichts außerhalb', async () => {
    const { dialog, max, ruhe, speichern, onSpeichern } = zeige(VORGABEN);
    await userEvent.type(max, '45 min');
    await userEvent.type(ruhe, '25 h');
    await userEvent.click(speichern);
    expect(await within(dialog).findByText('Zwischen 1 h und 24 h')).toBeInTheDocument();
    expect(within(dialog).getByText('Zwischen 0 min und 24 h')).toBeInTheDocument();
    expect(onSpeichern).not.toHaveBeenCalled();
  });
});
