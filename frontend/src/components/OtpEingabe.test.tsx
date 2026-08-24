import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderMitProviders } from '../test/utils';
import OtpEingabe from './OtpEingabe';

describe('OtpEingabe', () => {
  it('richtet die Eingabe auf Ziffern aus', () => {
    renderMitProviders(<OtpEingabe />);

    const feld = screen.getByRole('textbox');
    expect(feld).toHaveAttribute('inputmode', 'numeric');
    expect(feld).toHaveAttribute('maxlength', '6');
    expect(feld).toHaveAttribute('autocomplete', 'one-time-code');
    expect(feld).toHaveAttribute('pattern', '[0-9]*');
  });

  it('traegt die Ziffern-Optik der Anmeldeseite', () => {
    renderMitProviders(<OtpEingabe />);
    expect(screen.getByRole('textbox')).toHaveClass('login-otp');
  });

  it('meldet den vollen Code genau einmal', async () => {
    const onVoll = vi.fn();
    renderMitProviders(<OtpEingabe onVoll={onVoll} />);

    await userEvent.type(screen.getByRole('textbox'), '123456');

    expect(onVoll).toHaveBeenCalledTimes(1);
    expect(onVoll).toHaveBeenCalledWith('123456');
  });

  // Der Riegel greift, solange der volle Code STEHT: eine zweite Änderungsmeldung mit
  // demselben sechsstelligen Wert (Paste auf die Auswahl, Rerender-Echo) darf keinen
  // zweiten Absendeversuch auslösen — ein TOTP-Code ist serverseitig genau einmal gültig,
  // der zweite Aufruf meldete „Code ungültig" für einen Code, der gerade funktioniert hat.
  it('meldet denselben vollen Code nicht zweimal', async () => {
    const onVoll = vi.fn();
    renderMitProviders(<OtpEingabe onVoll={onVoll} />);

    const feld = screen.getByRole('textbox');
    await userEvent.type(feld, '123456');
    fireEvent.change(feld, { target: { value: '123456' } });

    expect(onVoll).toHaveBeenCalledTimes(1);
  });

  // Die Gegenaussage — und der Grund, warum der Merker beim Kürzen zurückgesetzt wird:
  // wer nach einer Ablehnung dieselbe Ziffer erneut tippt, muss einen neuen Versuch
  // bekommen. Ein Riegel, der das verhindert, hielte die Person fest.
  it('meldet nach einer Korrektur wieder — auch bei gleichem Code', async () => {
    const onVoll = vi.fn();
    renderMitProviders(<OtpEingabe onVoll={onVoll} />);

    const feld = screen.getByRole('textbox');
    await userEvent.type(feld, '123456');
    await userEvent.type(feld, '{Backspace}6');

    expect(onVoll).toHaveBeenCalledTimes(2);
  });

  it('meldet einen NEUEN vollen Code wieder', async () => {
    const onVoll = vi.fn();
    renderMitProviders(<OtpEingabe onVoll={onVoll} />);

    const feld = screen.getByRole('textbox');
    await userEvent.type(feld, '123456');
    await userEvent.type(feld, '{Backspace}7');

    expect(onVoll).toHaveBeenCalledTimes(2);
    expect(onVoll).toHaveBeenLastCalledWith('123457');
  });

  it('meldet gar nicht, solange der Code kuerzer ist', async () => {
    const onVoll = vi.fn();
    renderMitProviders(<OtpEingabe onVoll={onVoll} />);

    await userEvent.type(screen.getByRole('textbox'), '12345');

    expect(onVoll).not.toHaveBeenCalled();
  });

  // Der Bezug Label→Feld haengt daran. Ohne Durchreichen zeigt das `<label for>` des
  // `Form.Item` ins Leere — fuer Vorlesende wie fuer `getByLabelText`.
  it('reicht die vom Formular vergebene id ans Feld durch', () => {
    renderMitProviders(<OtpEingabe id="totp_code" />);
    expect(screen.getByRole('textbox')).toHaveAttribute('id', 'totp_code');
  });

  it('reicht jede Aenderung an den Formular-Kanal durch', async () => {
    const onChange = vi.fn();
    renderMitProviders(<OtpEingabe onChange={onChange} />);

    await userEvent.type(screen.getByRole('textbox'), '12');

    expect(onChange).toHaveBeenLastCalledWith('12');
  });
});
