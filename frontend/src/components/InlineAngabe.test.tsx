import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Input } from 'antd';
import type { Dayjs } from 'dayjs';
import { describe, expect, it, vi } from 'vitest';
import { AnzeigeKonventionenProvider } from '../anzeige/AnzeigeKonventionenContext';
import { ZeitpunktEingabe } from '../anzeige/ZeitpunktEingabe';
import { alsBackendZeit, alsZeitpunkt } from '../anzeige/zeitEingabe';
import { mitProzessZone } from '../test/prozessZone';
import { renderMitProviders } from '../test/utils';
import { tippeZeit } from '../test/zeitEingabe';
import { ApiError } from '../api/client';
import { InlineAngabe, leerKnopfStil, type InlineAngabeProps } from './InlineAngabe';

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

  // LFH-964: am Handy (390 px) lief „Nächste Lagebesprechung eintragen“ über den Paneelrand,
  // weil antds Knopf nicht umbricht. Der Knopf bricht um und hält den Boden der Dichte-Staffel.
  it('leer: der Knopf bricht um, statt über den Rand zu laufen', () => {
    renderMitProviders(<TextAngabe wert="" />);
    const knopf = screen.getByRole('button', { name: 'Leitstellen-Nr. eintragen' });
    expect(knopf.style.whiteSpace).toBe('normal');
    expect(knopf.style.height).toBe('auto');
    expect(knopf.style.maxWidth).toBe('100%');
    expect(knopf.style.overflowWrap).toBe('anywhere');
  });

  it('leerKnopfStil: Boden aus controlHeight in jeder Dichtestufe', () => {
    for (const controlHeight of [30, 48, 72]) {
      expect(leerKnopfStil({ controlHeight, paddingXS: 4 }, '#00f')).toMatchObject({
        minHeight: controlHeight,
        whiteSpace: 'normal',
        textAlign: 'start',
        color: '#00f',
      });
    }
  });

  // LLH-1067: in einer Liste stehen n gleiche Angaben; die Zeilenkennung trennt ihre Namen, der
  // sichtbare Text bleibt kurz.
  it('mit Kennung: die Namen nennen die Zeile, der sichtbare Text nicht', async () => {
    const { rerender } = renderMitProviders(<TextAngabe wert="" kennung="Anna" />);
    const leer = screen.getByRole('button', { name: 'Leitstellen-Nr. zu Anna eintragen' });
    expect(leer).toHaveTextContent(/^Leitstellen-Nr\. eintragen$/);
    rerender(<TextAngabe wert="ILS-1" kennung="Anna" />);
    await userEvent.click(
      screen.getByRole('button', { name: 'Leitstellen-Nr. zu Anna bearbeiten' }),
    );
    expect(screen.getByRole('textbox', { name: 'Leitstellen-Nr. zu Anna' })).toHaveFocus();
    expect(
      screen.getByRole('button', { name: 'Leitstellen-Nr. zu Anna speichern' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Bearbeitung von Leitstellen-Nr. zu Anna abbrechen' }),
    ).toBeInTheDocument();
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

  // LFH-1170: eine Eingabe, die ihren Fehler selbst zeigt (Koordinate), sperrt das Senden.
  it('ungültiger Entwurf: kein Senden, die Eingabe bleibt mit dem Entwurf offen', async () => {
    const onSpeichern = vi.fn().mockResolvedValue(undefined);
    renderMitProviders(
      <TextAngabe wert="ILS-1" isValid={(w) => !w.includes(';')} onSpeichern={onSpeichern} />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Leitstellen-Nr. bearbeiten' }));
    const feld = screen.getByRole('textbox', { name: 'Leitstellen-Nr.' });
    await user.clear(feld);
    await user.type(feld, 'ILS;2{Enter}');
    expect(onSpeichern).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: 'Leitstellen-Nr.' })).toHaveValue('ILS;2');

    // Über den Knopf: kein Senden, der Fokus kehrt ins Feld zurück, das seinen Fehler selbst nennt.
    await user.click(screen.getByRole('button', { name: 'Leitstellen-Nr. speichern' }));
    expect(onSpeichern).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: 'Leitstellen-Nr.' })).toHaveFocus();

    await user.clear(screen.getByRole('textbox', { name: 'Leitstellen-Nr.' }));
    await user.type(screen.getByRole('textbox', { name: 'Leitstellen-Nr.' }), 'ILS-2{Enter}');
    await waitFor(() => expect(onSpeichern).toHaveBeenCalledWith('ILS-2'));
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

/**
 * Eine Zeiteingabe als Eingabe (LLH-1070, `anzeige/ZeitpunktEingabe.tsx`): Enter übernimmt den
 * getippten Zeitpunkt (`onChange`) und sendet im SELBEN Tastendruck das Formular. Läse das Absenden
 * den Entwurf aus dem Zustand, sähe es den alten Wert und schlösse „unverändert“.
 */
describe('InlineAngabe · Zeiteingabe als Eingabe', () => {
  mitProzessZone('UTC');

  function ZeitAngabe({ onSpeichern }: { onSpeichern: (d: Dayjs | null) => Promise<unknown> }) {
    return (
      <AnzeigeKonventionenProvider konventionen={{ zeitzone: 'Europe/Berlin' }}>
        <InlineAngabe<Dayjs | null>
          etikett="Alarmzeit"
          wert={alsZeitpunkt('2026-07-14 10:00:00') ?? null}
          anzeige="141200jul26"
          leer={(d) => d === null}
          gleich={(a, b) => (a && b ? a.valueOf() === b.valueOf() : a === b)}
          pflicht
          darfSchreiben
          onSpeichern={onSpeichern}
          eingabe={({ feld, popup, value, onChange }) => (
            <ZeitpunktEingabe
              {...feld}
              {...popup}
              value={value}
              onChange={(d) => onChange(d ?? null)}
            />
          )}
        />
      </AnzeigeKonventionenProvider>
    );
  }

  it('getippt + Enter sendet den NEUEN Zeitpunkt', async () => {
    const onSpeichern = vi.fn<(d: Dayjs | null) => Promise<unknown>>().mockResolvedValue(undefined);
    renderMitProviders(<ZeitAngabe onSpeichern={onSpeichern} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Alarmzeit bearbeiten' }));
    const feld = screen.getByRole('textbox', { name: 'Alarmzeit' });
    expect(feld).toHaveValue('141200jul26');
    // 14.07.2026 13:00 Berliner Wanduhr = 11:00 UTC.
    await tippeZeit(user, feld, '141300jul26');
    expect(onSpeichern).toHaveBeenCalledTimes(1);
    expect(alsBackendZeit(onSpeichern.mock.calls[0][0]!)).toBe('2026-07-14 11:00:00');
  });

  it('sendet den neuen Zeitpunkt auch, wenn das Absenden vor dem Neurendern kommt', async () => {
    const onSpeichern = vi.fn<(d: Dayjs | null) => Promise<unknown>>().mockResolvedValue(undefined);
    renderMitProviders(<ZeitAngabe onSpeichern={onSpeichern} />);
    await userEvent.click(screen.getByRole('button', { name: 'Alarmzeit bearbeiten' }));
    const feld = screen.getByRole('textbox', { name: 'Alarmzeit' });
    fireEvent.change(feld, { target: { value: '141300jul26' } });
    // Übernahme (Enter) und Absenden in EINEM Durchlauf: React rendert erst nach beiden, das
    // Absenden sieht also noch den alten Zustand — nur der Entwurf in der Ref ist schon neu.
    act(() => {
      fireEvent.keyDown(feld, { key: 'Enter' });
      fireEvent.submit(feld.closest('form')!);
    });
    await waitFor(() => expect(onSpeichern).toHaveBeenCalledTimes(1));
    expect(alsBackendZeit(onSpeichern.mock.calls[0][0]!)).toBe('2026-07-14 11:00:00');
  });

  it('Escape bei offenem Kalender schließt erst den Kalender, das zweite verwirft die Zeile', async () => {
    const onSpeichern = vi.fn().mockResolvedValue(undefined);
    renderMitProviders(<ZeitAngabe onSpeichern={onSpeichern} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Alarmzeit bearbeiten' }));
    const kalenderKnopf = screen.getByRole('button', { name: 'Kalender und Uhrzeit' });
    await user.click(kalenderKnopf);
    // Der Kalender nimmt beim Öffnen den Fokus (Uhrzeitfeld); dort landet das erste Escape.
    await screen.findByRole('dialog', { name: 'Tag und Uhrzeit wählen' });
    await user.keyboard('{Escape}');
    expect(kalenderKnopf).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('textbox', { name: 'Alarmzeit' })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Alarmzeit' }), { key: 'Escape' });
    expect(screen.queryByRole('textbox', { name: 'Alarmzeit' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Alarmzeit bearbeiten' })).toBeInTheDocument();
    expect(onSpeichern).not.toHaveBeenCalled();
  });
});
