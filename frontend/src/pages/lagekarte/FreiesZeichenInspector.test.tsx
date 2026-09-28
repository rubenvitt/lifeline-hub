import { afterEach, describe, it, expect, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
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
  const element = (zeichen: FreiesZeichen) => (
    <FreiesZeichenInspector
      zeichen={zeichen}
      darfSchreiben={opts.darfSchreiben ?? true}
      onSchliessen={() => {}}
      onAendern={onAendern}
      onLoeschen={onLoeschen}
      ansichten={[]}
      onVerschieben={() => {}}
    />
  );
  const ergebnis = renderMitProviders(element(opts.zeichen ?? basis));
  /** Neuer Serverstand, wie ihn die Live-Invalidierung bringt (gleiche `id`, kein Remount). */
  const serverstand = (zeichen: FreiesZeichen) => ergebnis.rerender(element(zeichen));
  return { onAendern, onLoeschen, serverstand, unmount: ergebnis.unmount };
}

describe('FreiesZeichenInspector', () => {
  it('rendert mit vorbelegtem Picker (Grundzeichen des Records gewählt)', () => {
    renderInspector();
    expect(kachel('Taktische Formation')).toHaveAttribute('aria-checked', 'true');
  });

  it('nimmt dem Kartenklick nicht den Fokus (kein autoFokus im Inspector)', () => {
    renderInspector();
    expect(screen.getByLabelText('Grundzeichen suchen')).not.toHaveFocus();
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

const kachel = (name: string) =>
  within(screen.getByRole('radiogroup', { name: 'Grundzeichen' })).getByRole('radio', { name });

/**
 * Entprelltes Schreiben (LFH-716, D6). Als Raster meldet jeder Pfeilschritt eine Auswahl,
 * und `onAendern` führt auf ein PATCH samt Invalidierung und Live-Ereignis — ohne Frist
 * schriebe das Durchsteppen des Katalogs jeden Zwischenstand in die Datenbank.
 */
describe('FreiesZeichenInspector — entprelltes Schreiben (LFH-716)', () => {
  afterEach(() => vi.useRealTimers());

  it('schreibt beim bloßen Öffnen nichts', () => {
    vi.useFakeTimers();
    const { onAendern } = renderInspector();
    act(() => vi.advanceTimersByTime(2000));
    expect(onAendern).not.toHaveBeenCalled();
  });

  it('fasst schnelle Auswahlwechsel zu EINEM Schreibvorgang mit dem letzten Stand zusammen', () => {
    vi.useFakeTimers();
    const { onAendern } = renderInspector();
    for (const name of ['Person', 'Befehlsstelle', 'Gebäude']) {
      fireEvent.click(kachel(name));
      act(() => vi.advanceTimersByTime(200));
    }
    expect(onAendern).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(700));
    expect(onAendern).toHaveBeenCalledTimes(1);
    expect(onAendern).toHaveBeenCalledWith(expect.objectContaining({ grundzeichen: 'gebaeude' }));
  });

  it('holt eine Änderung nach, die beim Schließen noch in der Frist stand', () => {
    vi.useFakeTimers();
    const { onAendern, unmount } = renderInspector();
    fireEvent.click(kachel('Person'));
    unmount();
    expect(onAendern).toHaveBeenCalledTimes(1);
    expect(onAendern).toHaveBeenCalledWith(expect.objectContaining({ grundzeichen: 'person' }));
  });

  it('schreibt beim Schließen ohne Änderung nichts', () => {
    vi.useFakeTimers();
    const { onAendern, unmount } = renderInspector();
    unmount();
    expect(onAendern).not.toHaveBeenCalled();
  });

  // Das Paar zum Riegel gegen den Fremd-Refetch (CLAUDE.md, C7): ohne eigene Änderung folgt
  // der Inspector dem Server; mit eigener sendet er genau einmal und nicht erneut, wenn der
  // eigene Stand zurückkommt.
  it('übernimmt eine fremde Änderung, solange nichts Eigenes offen ist, und schreibt nichts', () => {
    vi.useFakeTimers();
    const { onAendern, serverstand } = renderInspector();
    serverstand({ ...basis, grundzeichen: 'person', geaendert_at: 'später' });
    act(() => vi.advanceTimersByTime(2000));
    expect(onAendern).not.toHaveBeenCalled();
    expect(kachel('Person')).toHaveAttribute('aria-checked', 'true');
  });

  it('sendet eine eigene Änderung genau einmal, auch wenn der eigene Stand zurückkommt', () => {
    vi.useFakeTimers();
    const { onAendern, serverstand } = renderInspector();
    fireEvent.click(kachel('Person'));
    act(() => vi.advanceTimersByTime(700));
    expect(onAendern).toHaveBeenCalledTimes(1);
    const gesendet = vi.mocked(onAendern).mock.calls[0][0];
    serverstand({ ...basis, ...gesendet, geaendert_at: 'später' } as FreiesZeichen);
    act(() => vi.advanceTimersByTime(2000));
    expect(onAendern).toHaveBeenCalledTimes(1);
  });

  it('folgt nach dem eigenen Schreiben wieder fremden Änderungen', () => {
    vi.useFakeTimers();
    const { onAendern, serverstand } = renderInspector();
    fireEvent.click(kachel('Person'));
    act(() => vi.advanceTimersByTime(700));
    const gesendet = vi.mocked(onAendern).mock.calls[0][0];
    serverstand({ ...basis, ...gesendet, geaendert_at: 't1' } as FreiesZeichen);
    serverstand({ ...basis, grundzeichen: 'befehlsstelle', geaendert_at: 't2' });
    act(() => vi.advanceTimersByTime(2000));
    expect(onAendern).toHaveBeenCalledTimes(1);
    expect(kachel('Befehlsstelle')).toHaveAttribute('aria-checked', 'true');
  });
});
