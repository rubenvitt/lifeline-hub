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
import { InlineAngabe, OFFEN_LASSEN, leerKnopfStil, type InlineAngabeProps } from './InlineAngabe';

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
    const kalenderKnopf = screen.getByRole('button', { name: /^Kalender und Uhrzeit/ });
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

/**
 * Erweiterung für die feldweise Bearbeitung der Personendaten (LLH-1103, Change
 * `f8218h1i-personendaten-feldweise`, design.md D3): Prüfung am Feld, Sperrgrund, Entwurfsmeldung,
 * Knopfabstand. Alle Props optional; die Fälle oben laufen ohne sie unverändert.
 *
 * Mutationsproben (von Hand, je rot gesehen, dann zurückgedreht):
 * - `pruefe` nicht in `abschicken` gefragt: „130“ geht hinaus, rot in „Prüffehler am Feld“.
 * - `aria-describedby` ohne die Kennung der Fehlerzeile: rot in „Prüffehler am Feld“.
 * - `disabled` am Wertknopf entfernt: der gesperrte Knopf öffnet, rot in „gesperrt: Auslöser“.
 * - Sperre schließt eine unveränderte Bearbeitung nicht: rot in „schließt, sobald die Sperre
 *   kommt“.
 * - Entwurfsmeldung ohne Flankenriegel (jede Änderung meldet): rot in „meldet nur die Wechsel“.
 * - Abmelden beim Aushängen entfernt: rot in „Aushängen mit Entwurf“.
 * - `size="middle"` entfernt: rot in „Knopfabstand“.
 */
describe('InlineAngabe · Prüfung am Feld (pruefe)', () => {
  const hoechstens120 = (w: string) => (Number(w) > 120 ? 'höchstens 120' : null);

  it('Prüffehler am Feld: kein Senden, Meldung als Fehlerzeile, Feld ungültig und beschrieben', async () => {
    const onSpeichern = vi.fn().mockResolvedValue(undefined);
    renderMitProviders(
      <TextAngabe wert="45" etikett="Alter" pruefe={hoechstens120} onSpeichern={onSpeichern} />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Alter bearbeiten' }));
    const feld = screen.getByRole('textbox', { name: 'Alter' });
    // Beim Tippen noch kein Fehler: der Grund kommt erst mit dem Absenden.
    await user.clear(feld);
    await user.type(feld, '130');
    expect(screen.queryByText('höchstens 120')).toBeNull();
    expect(feld).not.toHaveAttribute('aria-invalid');

    await user.click(screen.getByRole('button', { name: 'Alter speichern' }));
    expect(onSpeichern).not.toHaveBeenCalled();
    const meldung = screen.getByText('höchstens 120');
    expect(meldung).toHaveAttribute('data-fehler');
    expect(feld).toHaveAttribute('aria-invalid', 'true');
    expect(feld.getAttribute('aria-describedby')).toBe(meldung.id);
    expect(feld).toHaveAccessibleDescription('höchstens 120');
    expect(feld).toHaveFocus();
    expect(feld).toHaveValue('130');

    // Nach dem ersten Fehlversuch folgt die Meldung dem Entwurf.
    await user.clear(feld);
    await user.type(feld, '99');
    expect(screen.queryByText('höchstens 120')).toBeNull();
    expect(feld).not.toHaveAttribute('aria-invalid');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(onSpeichern).toHaveBeenCalledWith('99'));
  });

  it('Enter sendet ebenso nicht', async () => {
    const onSpeichern = vi.fn().mockResolvedValue(undefined);
    renderMitProviders(
      <TextAngabe wert="" etikett="Alter" pruefe={hoechstens120} onSpeichern={onSpeichern} />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Alter eintragen' }));
    await user.type(screen.getByRole('textbox', { name: 'Alter' }), '130{Enter}');
    expect(onSpeichern).not.toHaveBeenCalled();
    expect(screen.getByText('höchstens 120')).toBeInTheDocument();
  });

  it('ein unveränderter Wert wird nicht geprüft (Altbestand bleibt stehen)', async () => {
    const onSpeichern = vi.fn().mockResolvedValue(undefined);
    renderMitProviders(
      <TextAngabe wert="130" etikett="Alter" pruefe={hoechstens120} onSpeichern={onSpeichern} />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Alter bearbeiten' }));
    await user.keyboard('{Enter}');
    expect(screen.queryByText('höchstens 120')).toBeNull();
    expect(screen.getByRole('button', { name: 'Alter bearbeiten' })).toBeInTheDocument();
    expect(onSpeichern).not.toHaveBeenCalled();
  });

  it('beim nächsten Öffnen ist die Meldung fort', async () => {
    renderMitProviders(<TextAngabe wert="45" etikett="Alter" pruefe={hoechstens120} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Alter bearbeiten' }));
    await user.type(screen.getByRole('textbox', { name: 'Alter' }), '0{Enter}');
    expect(screen.getByText('höchstens 120')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Bearbeitung von Alter abbrechen' }));
    await user.click(screen.getByRole('button', { name: 'Alter bearbeiten' }));
    expect(screen.queryByText('höchstens 120')).toBeNull();
  });
});

describe('InlineAngabe · Sperrgrund (gesperrt)', () => {
  const GRUND = 'Ohne Verbindung nicht änderbar';

  it('gesperrt: Auslöser nicht bedienbar, Grund sichtbar und als Beschreibung', async () => {
    const { rerender } = renderMitProviders(<TextAngabe wert="ILS-1" gesperrt={GRUND} />);
    const knopf = screen.getByRole('button', { name: 'Leitstellen-Nr. bearbeiten' });
    expect(knopf).toBeDisabled();
    expect(screen.getByText(GRUND)).toBeVisible();
    expect(knopf).toHaveAccessibleDescription(`ILS-1 ${GRUND}`);
    await userEvent.click(knopf);
    expect(screen.queryByRole('textbox')).toBeNull();

    rerender(<TextAngabe wert="" gesperrt={GRUND} />);
    const leer = screen.getByRole('button', { name: 'Leitstellen-Nr. eintragen' });
    expect(leer).toBeDisabled();
    expect(leer).toHaveAccessibleDescription(GRUND);
    expect(screen.getByText(GRUND)).toBeVisible();
  });

  it('ohne Schreibrecht kein Sperrgrund: es gibt nichts zu bedienen', () => {
    renderMitProviders(<TextAngabe wert="ILS-1" darfSchreiben={false} gesperrt={GRUND} />);
    expect(screen.queryByText(GRUND)).toBeNull();
    expect(screen.getByText('ILS-1')).toBeInTheDocument();
  });

  it('eine offene Bearbeitung ohne Änderung schließt, sobald die Sperre kommt', async () => {
    const { rerender } = renderMitProviders(<TextAngabe wert="ILS-1" />);
    await userEvent.click(screen.getByRole('button', { name: 'Leitstellen-Nr. bearbeiten' }));
    expect(screen.getByRole('textbox')).toBeInTheDocument();
    rerender(<TextAngabe wert="ILS-1" gesperrt={GRUND} />);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByRole('button', { name: 'Leitstellen-Nr. bearbeiten' })).toBeDisabled();
  });

  it('ein Entwurf bleibt bei der Sperre stehen, sendet aber nicht', async () => {
    const onSpeichern = vi.fn().mockResolvedValue(undefined);
    const { rerender } = renderMitProviders(<TextAngabe wert="ILS-1" onSpeichern={onSpeichern} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Leitstellen-Nr. bearbeiten' }));
    await user.type(screen.getByRole('textbox'), '2');
    rerender(<TextAngabe wert="ILS-1" gesperrt={GRUND} onSpeichern={onSpeichern} />);

    const feld = screen.getByRole('textbox', { name: 'Leitstellen-Nr.' });
    expect(feld).toHaveValue('ILS-12');
    expect(screen.getByText(GRUND)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Leitstellen-Nr. speichern' })).toBeDisabled();
    fireEvent.submit(feld.closest('form')!);
    expect(onSpeichern).not.toHaveBeenCalled();
    // Abbrechen bleibt: der Entwurf lässt sich verwerfen.
    await user.click(
      screen.getByRole('button', { name: 'Bearbeitung von Leitstellen-Nr. abbrechen' }),
    );
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});

describe('InlineAngabe · Entwurfsmeldung (onEntwurf)', () => {
  it('meldet nur die Wechsel zwischen unverändert und geändert', async () => {
    const onEntwurf = vi.fn();
    renderMitProviders(<TextAngabe wert="ILS-1" onEntwurf={onEntwurf} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Leitstellen-Nr. bearbeiten' }));
    // Ein offenes Feld ohne Änderung meldet sich nicht.
    expect(onEntwurf).not.toHaveBeenCalled();

    const feld = screen.getByRole('textbox', { name: 'Leitstellen-Nr.' });
    await user.type(feld, '23');
    expect(onEntwurf.mock.calls).toEqual([[true]]);

    // Zurück auf den gespeicherten Wert: wieder unverändert.
    await user.type(feld, '{Backspace}{Backspace}');
    expect(onEntwurf.mock.calls).toEqual([[true], [false]]);

    await user.type(feld, '9');
    await user.click(
      screen.getByRole('button', { name: 'Bearbeitung von Leitstellen-Nr. abbrechen' }),
    );
    expect(onEntwurf.mock.calls).toEqual([[true], [false], [true], [false]]);
  });

  it('gespeichert: unverändert; abgelehnt: der Entwurf bleibt gemeldet', async () => {
    const onEntwurf = vi.fn();
    const onSpeichern = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(400, 'Server sagt nein'))
      .mockResolvedValueOnce(undefined);
    renderMitProviders(<TextAngabe wert="ILS-1" onEntwurf={onEntwurf} onSpeichern={onSpeichern} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Leitstellen-Nr. bearbeiten' }));
    await user.type(screen.getByRole('textbox'), '2{Enter}');
    expect(await screen.findByText('Server sagt nein')).toBeInTheDocument();
    expect(onEntwurf.mock.calls).toEqual([[true]]);

    await user.keyboard('{Enter}');
    await waitFor(() => expect(onEntwurf.mock.calls).toEqual([[true], [false]]));
  });

  it('Aushängen mit Entwurf meldet unverändert', async () => {
    const onEntwurf = vi.fn();
    const { unmount } = renderMitProviders(<TextAngabe wert="ILS-1" onEntwurf={onEntwurf} />);
    await userEvent.click(screen.getByRole('button', { name: 'Leitstellen-Nr. bearbeiten' }));
    await userEvent.type(screen.getByRole('textbox'), '2');
    unmount();
    expect(onEntwurf.mock.calls).toEqual([[true], [false]]);
  });
});

describe('InlineAngabe · Knopfabstand', () => {
  it('Speichern und Abbrechen stehen in der Stufe „middle“ auseinander (frontend/AGENTS.md)', async () => {
    renderMitProviders(<TextAngabe wert="ILS-1" />);
    await userEvent.click(screen.getByRole('button', { name: 'Leitstellen-Nr. bearbeiten' }));
    const reihe = screen
      .getByRole('button', { name: 'Leitstellen-Nr. speichern' })
      .closest('.ant-space');
    expect(reihe).toHaveClass('ant-space-gap-col-middle');
  });
});

/**
 * Sperrgrund an anderer Stelle (LLH-1103, Entscheidung des Orchestrators zu D8): EIN Grund am Kopf
 * eines Abschnitts statt einer Zeile je Feld. Das Feld ist gesperrt und verweist nur auf ihn.
 *
 * Mutationsprobe: externe Kennung nicht ins `aria-describedby` — rot in „verweist auf den Grund“.
 */
describe('InlineAngabe · Sperrgrund an anderer Stelle', () => {
  it('gesperrt, ohne eigene Zeile, verweist auf den Grund', async () => {
    const { rerender } = renderMitProviders(
      <>
        <div id="grund-oben">Ohne Verbindung nicht änderbar</div>
        <TextAngabe wert="ILS-1" gesperrt={{ beschreibungId: 'grund-oben' }} />
      </>,
    );
    const knopf = screen.getByRole('button', { name: 'Leitstellen-Nr. bearbeiten' });
    expect(knopf).toBeDisabled();
    expect(knopf).toHaveAccessibleDescription('ILS-1 Ohne Verbindung nicht änderbar');
    expect(screen.getAllByText('Ohne Verbindung nicht änderbar')).toHaveLength(1);

    rerender(
      <>
        <div id="grund-oben">Ohne Verbindung nicht änderbar</div>
        <TextAngabe wert="" gesperrt={{ beschreibungId: 'grund-oben' }} />
      </>,
    );
    const leer = screen.getByRole('button', { name: 'Leitstellen-Nr. eintragen' });
    expect(leer).toBeDisabled();
    expect(leer).toHaveAccessibleDescription('Ohne Verbindung nicht änderbar');
  });
});

/**
 * `onOeffnen` (LLH-1103, D1): der Aufrufer hält beim Öffnen den Serverstand fest, gegen den der
 * Feld-CAS vergleicht; ein späterer Refetch ändert ihn nicht mehr.
 */
describe('InlineAngabe · onOeffnen', () => {
  it('meldet jedes Öffnen, nicht das Schließen', async () => {
    const onOeffnen = vi.fn();
    renderMitProviders(<TextAngabe wert="ILS-1" onOeffnen={onOeffnen} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Leitstellen-Nr. bearbeiten' }));
    expect(onOeffnen).toHaveBeenCalledTimes(1);
    await user.keyboard('{Escape}');
    expect(onOeffnen).toHaveBeenCalledTimes(1);
  });
});

/**
 * `onSchliessen` (LLH-1103): mit `onOeffnen` hält der Aufrufer ein offenes Feld an seinem Ort, bis
 * es schließt. Gemeldet wird jedes Schließen — abgebrochen, gespeichert, ausgehängt —, nie ohne
 * vorheriges Öffnen. Mutationsprobe: nur beim Abbrechen melden — der Speicherfall bleibt stumm,
 * rot.
 */
describe('InlineAngabe · onSchliessen', () => {
  it('meldet Abbrechen, Speichern und Aushängen einer offenen Bearbeitung', async () => {
    const onSchliessen = vi.fn();
    const { unmount } = renderMitProviders(<TextAngabe wert="ILS-1" onSchliessen={onSchliessen} />);
    const user = userEvent.setup();
    expect(onSchliessen).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Leitstellen-Nr. bearbeiten' }));
    await user.keyboard('{Escape}');
    expect(onSchliessen).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Leitstellen-Nr. bearbeiten' }));
    await user.type(screen.getByRole('textbox', { name: 'Leitstellen-Nr.' }), '2{Enter}');
    await waitFor(() => expect(onSchliessen).toHaveBeenCalledTimes(2));

    await user.click(screen.getByRole('button', { name: 'Leitstellen-Nr. bearbeiten' }));
    unmount();
    expect(onSchliessen).toHaveBeenCalledTimes(3);
  });

  it('ohne offene Bearbeitung meldet auch das Aushängen nichts', () => {
    const onSchliessen = vi.fn();
    const { unmount } = renderMitProviders(<TextAngabe wert="ILS-1" onSchliessen={onSchliessen} />);
    unmount();
    expect(onSchliessen).not.toHaveBeenCalled();
  });
});

/**
 * `OFFEN_LASSEN` (LLH-1103, Personendaten: Escape in der Rückfrage „Zwischenzeitlich geändert“):
 * nichts gespeichert, nichts gescheitert — die Eingabe bleibt mit dem Entwurf offen, ohne Fehler.
 * Mutationsprobe: das Ergebnis von `onSpeichern` nicht beachten — die Eingabe schließt, rot.
 */
describe('InlineAngabe · OFFEN_LASSEN', () => {
  it('die Eingabe bleibt mit dem Entwurf offen, ohne Fehler', async () => {
    const onSpeichern = vi.fn().mockResolvedValue(OFFEN_LASSEN);
    renderMitProviders(<TextAngabe wert="ILS-1" onSpeichern={onSpeichern} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Leitstellen-Nr. bearbeiten' }));
    await user.type(screen.getByRole('textbox', { name: 'Leitstellen-Nr.' }), '2{Enter}');
    await waitFor(() => expect(onSpeichern).toHaveBeenCalledWith('ILS-12'));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Leitstellen-Nr. speichern' })).not.toHaveClass(
        'ant-btn-loading',
      ),
    );
    expect(screen.getByRole('textbox', { name: 'Leitstellen-Nr.' })).toHaveValue('ILS-12');
    expect(document.querySelector('[data-fehler]')).toBeNull();
  });
});
