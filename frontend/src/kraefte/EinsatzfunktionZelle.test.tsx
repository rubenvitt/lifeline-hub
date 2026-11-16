import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderMitProviders } from '../test/utils';
import EinsatzfunktionZelle, {
  stiftStil,
  type EinsatzfunktionZelleProps,
} from './EinsatzfunktionZelle';

function zelle(p: Partial<EinsatzfunktionZelleProps> = {}) {
  const onSpeichern = p.onSpeichern ?? vi.fn().mockResolvedValue(undefined);
  renderMitProviders(
    <EinsatzfunktionZelle
      name="Anna Muster"
      funktion="Notfallsanitäter"
      vorschlaege={['Gruppenführer', 'Melder', 'Sprechfunker']}
      darfSchreiben
      {...p}
      onSpeichern={onSpeichern}
    />,
  );
  return onSpeichern;
}

describe('EinsatzfunktionZelle (LLH-1067)', () => {
  it('zeigt die Qualifikation sichtbar unter der Einsatzfunktion', () => {
    zelle({ einsatzfunktion: 'Sprechfunker' });
    const knopf = screen.getByRole('button', { name: 'Funktion zu Anna Muster bearbeiten' });
    expect(knopf).toHaveAccessibleDescription('Sprechfunker');
    expect(screen.getByText('Notfallsanitäter')).toBeVisible();
  });

  it('leer mit Qualifikation: die Qualifikation als Wert, daneben ein Stift ohne Wort (LLH-1791)', () => {
    zelle();
    const qualifikation = screen.getByText('Notfallsanitäter');
    // Als Wert, nicht gedämpft.
    expect(qualifikation.closest('.ant-typography-secondary')).toBeNull();
    const stift = screen.getByRole('button', { name: 'Funktion zu Anna Muster eintragen' });
    expect(stift).not.toHaveTextContent('Funktion eintragen');
    expect(screen.queryByText('Funktion eintragen')).toBeNull();
  });

  it('leer ohne Qualifikation: die Aufforderung als Wort bleibt', () => {
    zelle({ funktion: null });
    expect(
      screen.getByRole('button', { name: 'Funktion zu Anna Muster eintragen' }),
    ).toHaveTextContent('Funktion eintragen');
  });

  it('der Stift trägt den Boden der Stufe als Literale (stiftStil)', () => {
    for (const h of [24, 48, 72]) {
      expect(stiftStil({ controlHeightSM: h })).toMatchObject({ minWidth: h, minHeight: h });
    }
  });

  it('schlägt passend zur Eingabe vor und sendet den gewählten Wert', async () => {
    const onSpeichern = zelle();
    await userEvent.click(
      screen.getByRole('button', { name: 'Funktion zu Anna Muster eintragen' }),
    );
    const feld = screen.getByRole('combobox', { name: 'Funktion zu Anna Muster' });
    expect(feld).toHaveAttribute('maxlength', '200');
    await userEvent.type(feld, 'funk');
    // Nur „Sprechfunker“ passt; „Melder“ und „Gruppenführer“ fehlen in der Liste.
    const option = await screen.findByText(
      (_, el) =>
        el?.className === 'ant-select-item-option-content' && el?.textContent === 'Sprechfunker',
    );
    expect(document.querySelectorAll('.ant-select-item-option')).toHaveLength(1);
    await userEvent.click(option);
    await userEvent.click(
      screen.getByRole('button', { name: 'Funktion zu Anna Muster speichern' }),
    );
    await waitFor(() => expect(onSpeichern).toHaveBeenCalledWith('Sprechfunker'));
  });

  it('ein geleertes Feld sendet null', async () => {
    const onSpeichern = zelle({ einsatzfunktion: 'Melder' });
    await userEvent.click(
      screen.getByRole('button', { name: 'Funktion zu Anna Muster bearbeiten' }),
    );
    await userEvent.clear(screen.getByRole('combobox', { name: 'Funktion zu Anna Muster' }));
    await userEvent.click(
      screen.getByRole('button', { name: 'Funktion zu Anna Muster speichern' }),
    );
    await waitFor(() => expect(onSpeichern).toHaveBeenCalledWith(null));
  });

  it('ohne Schreibrecht: Einsatzfunktion und Qualifikation als Text, ohne Knopf', () => {
    zelle({ einsatzfunktion: 'Melder', darfSchreiben: false });
    expect(screen.getByText('Melder')).toBeVisible();
    expect(screen.getByText('Notfallsanitäter')).toBeVisible();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('ohne Schreibrecht und ohne Einsatzfunktion: nur die Qualifikation, ohne „—“ davor', () => {
    zelle({ darfSchreiben: false });
    expect(screen.getByText('Notfallsanitäter')).toBeVisible();
    expect(screen.queryByText('—')).toBeNull();
  });
});
