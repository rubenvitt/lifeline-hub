import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Input } from 'antd';
import { describe, expect, it, vi } from 'vitest';
import { renderMitProviders } from '../test/utils';
import { ApiError } from '../api/client';
import { InlineAngabe, type InlineAngabeProps } from './InlineAngabe';

/**
 * Verhalten der inline bearbeitbaren Angabe (LFH-472).
 *
 * Kein antd-`Editable` im Spiel: Enter sendet das native `<form>`, Escape läuft über `key`. Die
 * `keyCode`-Falle aus `BemerkungZelle.test.tsx` gilt hier deshalb nicht — Tasten per `key`.
 */
type Props = Partial<InlineAngabeProps<string>>;

function TextAngabe(p: Props) {
  return (
    <InlineAngabe<string>
      etikett="Leitstellen-Nr."
      wert=""
      anzeige={p.wert ?? ''}
      leer={(w) => w.trim() === ''}
      darfSchreiben
      onSpeichern={vi.fn().mockResolvedValue(undefined)}
      eingabe={({ feld, value, onChange }) => (
        <Input {...feld} value={value} onChange={(e) => onChange(e.target.value)} />
      )}
      {...p}
    />
  );
}

describe('InlineAngabe · Anzeige', () => {
  it('gefüllt: der Wert ist der Knopf, benannt nach der Angabe, der Wert als Beschreibung', () => {
    renderMitProviders(<TextAngabe wert="ILS-1" />);
    const knopf = screen.getByRole('button', { name: 'Leitstellen-Nr. bearbeiten' });
    expect(knopf).toHaveAccessibleDescription('ILS-1');
  });

  it('leer: sichtbare Aufforderung zum Eintragen', () => {
    renderMitProviders(<TextAngabe wert="" />);
    expect(screen.getByRole('button', { name: 'Leitstellen-Nr. eintragen' })).toHaveTextContent(
      'Leitstellen-Nr. eintragen',
    );
  });

  it('ohne Schreibrecht: kein Knopf, leer als „—"', () => {
    const { rerender } = renderMitProviders(<TextAngabe wert="" darfSchreiben={false} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('—')).toBeInTheDocument();
    rerender(<TextAngabe wert="ILS-1" darfSchreiben={false} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('ILS-1')).toBeInTheDocument();
  });
});

describe('InlineAngabe · Bearbeitung', () => {
  it('öffnet eine benannte Eingabe mit dem bisherigen Wert und dem Fokus darin', async () => {
    renderMitProviders(<TextAngabe wert="ILS-1" />);
    await userEvent.click(screen.getByRole('button', { name: 'Leitstellen-Nr. bearbeiten' }));
    const feld = screen.getByRole('textbox', { name: 'Leitstellen-Nr.' });
    expect(feld).toHaveValue('ILS-1');
    expect(feld).toHaveFocus();
  });

  it('Enter sendet den neuen Wert', async () => {
    const onSpeichern = vi.fn().mockResolvedValue(undefined);
    renderMitProviders(<TextAngabe wert="ILS-1" onSpeichern={onSpeichern} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Leitstellen-Nr. bearbeiten' }));
    const feld = screen.getByRole('textbox', { name: 'Leitstellen-Nr.' });
    await user.clear(feld);
    await user.type(feld, 'ILS-4711{Enter}');
    expect(onSpeichern).toHaveBeenCalledTimes(1);
    expect(onSpeichern).toHaveBeenCalledWith('ILS-4711');
  });

  it('der Speichern-Knopf sendet ebenso', async () => {
    const onSpeichern = vi.fn().mockResolvedValue(undefined);
    renderMitProviders(<TextAngabe wert="" onSpeichern={onSpeichern} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Leitstellen-Nr. eintragen' }));
    await user.type(screen.getByRole('textbox', { name: 'Leitstellen-Nr.' }), 'X');
    await user.click(screen.getByRole('button', { name: 'Leitstellen-Nr. speichern' }));
    expect(onSpeichern).toHaveBeenCalledWith('X');
  });

  it('Escape und „Abbrechen" verwerfen ohne zu senden', async () => {
    const onSpeichern = vi.fn().mockResolvedValue(undefined);
    renderMitProviders(<TextAngabe wert="ILS-1" onSpeichern={onSpeichern} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Leitstellen-Nr. bearbeiten' }));
    await user.type(screen.getByRole('textbox', { name: 'Leitstellen-Nr.' }), 'zzz');
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Leitstellen-Nr.' }), { key: 'Escape' });
    expect(screen.queryByRole('textbox')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Leitstellen-Nr. bearbeiten' }));
    // Der Entwurf von eben ist verworfen, nicht aufbewahrt.
    expect(screen.getByRole('textbox', { name: 'Leitstellen-Nr.' })).toHaveValue('ILS-1');
    await user.type(screen.getByRole('textbox', { name: 'Leitstellen-Nr.' }), 'zzz');
    await user.click(
      screen.getByRole('button', { name: 'Bearbeitung von Leitstellen-Nr. abbrechen' }),
    );
    expect(screen.queryByRole('textbox')).toBeNull();

    expect(onSpeichern).not.toHaveBeenCalled();
  });

  it('mehrzeilig: Enter bleibt Zeilenumbruch, Strg+Enter sendet', async () => {
    const onSpeichern = vi.fn().mockResolvedValue(undefined);
    renderMitProviders(
      <TextAngabe
        wert=""
        etikett="Sachverhalt"
        mehrzeilig
        onSpeichern={onSpeichern}
        eingabe={({ feld, value, onChange }) => (
          <Input.TextArea {...feld} value={value} onChange={(e) => onChange(e.target.value)} />
        )}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Sachverhalt eintragen' }));
    const feld = screen.getByRole('textbox', { name: 'Sachverhalt' });
    await user.type(feld, 'Zeile 1{Enter}Zeile 2');
    expect(onSpeichern).not.toHaveBeenCalled();
    fireEvent.keyDown(feld, { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(onSpeichern).toHaveBeenCalledWith('Zeile 1\nZeile 2'));
  });
});

describe('InlineAngabe · Riegel', () => {
  it('unveränderter Wert sendet nicht und kehrt in die Anzeige zurück', async () => {
    const onSpeichern = vi.fn().mockResolvedValue(undefined);
    renderMitProviders(<TextAngabe wert="ILS-1" onSpeichern={onSpeichern} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Leitstellen-Nr. bearbeiten' }));
    await user.type(screen.getByRole('textbox', { name: 'Leitstellen-Nr.' }), '{Enter}');
    expect(onSpeichern).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Leitstellen-Nr. bearbeiten' })).toBeInTheDocument();
  });

  it('Pflichtangabe geleert: kein Senden, alter Wert steht wieder da, Hinweis an der Zeile', async () => {
    const onSpeichern = vi.fn().mockResolvedValue(undefined);
    renderMitProviders(
      <TextAngabe wert="09:00" etikett="Alarmzeit" pflicht onSpeichern={onSpeichern} />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Alarmzeit bearbeiten' }));
    await user.clear(screen.getByRole('textbox', { name: 'Alarmzeit' }));
    await user.keyboard('{Enter}');

    expect(onSpeichern).not.toHaveBeenCalled();
    expect(
      screen.getByRole('button', { name: 'Alarmzeit bearbeiten' }),
    ).toHaveAccessibleDescription('09:00');
    const hinweis = screen.getByText(
      'Alarmzeit ist eine Pflichtangabe — der bisherige Wert bleibt.',
    );
    expect(hinweis.closest('[data-fehler]')).not.toBeNull();

    // Beim nächsten Öffnen geht der Hinweis, die Eingabe steht auf dem alten Wert.
    await user.click(screen.getByRole('button', { name: 'Alarmzeit bearbeiten' }));
    expect(screen.queryByText(/ist eine Pflichtangabe/)).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Alarmzeit' })).toHaveValue('09:00');
  });

  it('eine optionale Angabe darf geleert werden', async () => {
    const onSpeichern = vi.fn().mockResolvedValue(undefined);
    renderMitProviders(<TextAngabe wert="ILS-1" onSpeichern={onSpeichern} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Leitstellen-Nr. bearbeiten' }));
    await user.clear(screen.getByRole('textbox', { name: 'Leitstellen-Nr.' }));
    await user.keyboard('{Enter}');
    expect(onSpeichern).toHaveBeenCalledWith('');
  });
});

describe('InlineAngabe · Fehler und Fokus', () => {
  it('abgelehntes Speichern: Eingabe bleibt mit Entwurf offen, Fehler an der Zeile', async () => {
    const onSpeichern = vi.fn().mockRejectedValue(new ApiError(400, 'Server sagt nein'));
    renderMitProviders(<TextAngabe wert="ILS-1" onSpeichern={onSpeichern} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Leitstellen-Nr. bearbeiten' }));
    const feld = screen.getByRole('textbox', { name: 'Leitstellen-Nr.' });
    await user.clear(feld);
    await user.type(feld, 'ILS-9{Enter}');

    expect(await screen.findByText('Server sagt nein')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Leitstellen-Nr.' })).toHaveValue('ILS-9');
  });

  it('ein zweites Enter während des Sendens sendet nicht noch einmal', async () => {
    let erfuellen: () => void = () => {};
    const onSpeichern = vi.fn(
      () =>
        new Promise<void>((r) => {
          erfuellen = r;
        }),
    );
    renderMitProviders(<TextAngabe wert="ILS-1" onSpeichern={onSpeichern} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Leitstellen-Nr. bearbeiten' }));
    await user.type(screen.getByRole('textbox', { name: 'Leitstellen-Nr.' }), '2{Enter}');
    fireEvent.submit(screen.getByRole('textbox', { name: 'Leitstellen-Nr.' }).closest('form')!);
    expect(onSpeichern).toHaveBeenCalledTimes(1);
    await act(async () => erfuellen());
  });

  it('nach dem Speichern liegt der Fokus auf dem Wertknopf, auch wenn der Wert nachkommt', async () => {
    const { rerender } = renderMitProviders(<TextAngabe wert="" />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Leitstellen-Nr. eintragen' }));
    await user.type(screen.getByRole('textbox', { name: 'Leitstellen-Nr.' }), 'ILS-4711{Enter}');
    rerender(<TextAngabe wert="ILS-4711" />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Leitstellen-Nr. bearbeiten' })).toHaveFocus(),
    );
  });

  it('nach dem Abbrechen liegt der Fokus wieder auf dem Auslöser', async () => {
    renderMitProviders(<TextAngabe wert="ILS-1" />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Leitstellen-Nr. bearbeiten' }));
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Leitstellen-Nr.' }), { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'Leitstellen-Nr. bearbeiten' })).toHaveFocus();
  });
});

/**
 * Eigener Auslöser (LFH-969): der Wert steht schon als Überschrift, der Auslöser heißt nach der
 * Handlung. Pflicht-Riegel und Fokusrückgabe bleiben die des Primitivs.
 */
describe('InlineAngabe · eigener Auslöser', () => {
  const umbenennen: InlineAngabeProps<string>['ausloeser'] = ({ ref, onClick }) => (
    <button type="button" ref={ref} onClick={onClick}>
      Umbenennen
    </button>
  );

  it('ersetzt den Wertknopf, gefüllt wie leer, und öffnet dieselbe Eingabe', async () => {
    const { rerender } = renderMitProviders(<TextAngabe wert="ILS-1" ausloeser={umbenennen} />);
    expect(screen.queryByRole('button', { name: 'Leitstellen-Nr. bearbeiten' })).toBeNull();
    rerender(<TextAngabe wert="" ausloeser={umbenennen} />);
    expect(screen.queryByRole('button', { name: 'Leitstellen-Nr. eintragen' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Umbenennen' }));
    expect(screen.getByRole('textbox', { name: 'Leitstellen-Nr.' })).toHaveFocus();
  });

  it('Pflicht geleert: kein Senden, Hinweis steht, der Fokus kehrt auf den Auslöser zurück', async () => {
    const onSpeichern = vi.fn().mockResolvedValue(undefined);
    renderMitProviders(
      <TextAngabe wert="ILS-1" pflicht ausloeser={umbenennen} onSpeichern={onSpeichern} />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Umbenennen' }));
    await user.clear(screen.getByRole('textbox', { name: 'Leitstellen-Nr.' }));
    await user.keyboard('{Enter}');
    expect(onSpeichern).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('Pflichtangabe');
    expect(screen.getByRole('button', { name: 'Umbenennen' })).toHaveFocus();
  });

  it('ohne Schreibrecht kein Auslöser', () => {
    renderMitProviders(<TextAngabe wert="ILS-1" darfSchreiben={false} ausloeser={umbenennen} />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
