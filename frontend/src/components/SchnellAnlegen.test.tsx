import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderMitProviders } from '../test/utils';
import SchnellAnlegen from './SchnellAnlegen';

/**
 * Die Zusicherungen von `SchnellAnlegen` (LFH-332 · B4).
 *
 * Was hier NICHT geprueft wird: Hoehen und Trefflaechen. `renderMitProviders`
 * montiert ein nacktes `ConfigProvider` ohne das Theme des Projekts — eine
 * Zusicherung auf Pixel bewiese dort etwas ueber antds Voreinstellung, nicht
 * ueber die Dichte-Staffel.
 */

function renderZeile(onAnlegen: (text: string) => Promise<unknown>, laeuft = false) {
  return renderMitProviders(
    <SchnellAnlegen
      beschriftung="Neue Qualifikation"
      platzhalter="z. B. Sanitäter"
      knopfText="Qualifikation anlegen"
      onAnlegen={onAnlegen}
      laeuft={laeuft}
    />,
  );
}

/** Das Feld wird ueber SEINE BESCHRIFTUNG gegriffen — das prueft die Verdrahtung
 *  `<label for>` ↔ `id` gleich mit. Ein Griff per Platzhalter waere auch dann
 *  gruen, wenn das Feld gar keinen zugaenglichen Namen haette. */
const feld = () => screen.getByLabelText('Neue Qualifikation');

describe('SchnellAnlegen', () => {
  it('Enter im Feld legt an — mit beschnittenem Text', async () => {
    const anlegen = vi.fn().mockResolvedValue(undefined);
    renderZeile(anlegen);

    // Die Leerzeichen sind Teil der Zusicherung: der Aufrufer bekommt den
    // beschnittenen Wert, muss also selbst nicht mehr trimmen.
    await userEvent.type(feld(), '  Sanitäter  {Enter}');

    await waitFor(() => expect(anlegen).toHaveBeenCalledWith('Sanitäter'));
  });

  it('der Knopf legt an', async () => {
    const anlegen = vi.fn().mockResolvedValue(undefined);
    renderZeile(anlegen);

    await userEvent.type(feld(), 'Gruppenführer');
    await userEvent.click(screen.getByRole('button', { name: 'Qualifikation anlegen' }));

    await waitFor(() => expect(anlegen).toHaveBeenCalledWith('Gruppenführer'));
  });

  it('leerer und rein aus Leerzeichen bestehender Text loesen nichts aus', async () => {
    const anlegen = vi.fn().mockResolvedValue(undefined);
    renderZeile(anlegen);

    // Erst gar nichts …
    await userEvent.click(screen.getByRole('button', { name: 'Qualifikation anlegen' }));
    // … dann Leerzeichen, ueber BEIDE Wege. Ohne den Enter-Zweig bliebe die
    // Pruefung gruen, wenn nur der Klick-Zweig den Wert beschnitte.
    await userEvent.type(feld(), '   {Enter}');
    await userEvent.click(screen.getByRole('button', { name: 'Qualifikation anlegen' }));

    expect(anlegen).not.toHaveBeenCalled();
  });

  it('nach Erfolg ist das Feld leer und traegt wieder den Fokus', async () => {
    const anlegen = vi.fn().mockResolvedValue(undefined);
    renderZeile(anlegen);

    await userEvent.type(feld(), 'Sanitäter');
    // Ueber den KNOPF, nicht ueber Enter: nur so verlaesst der Fokus das Feld
    // ueberhaupt. Mit Enter waere die Fokus-Zusicherung trivial gruen.
    await userEvent.click(screen.getByRole('button', { name: 'Qualifikation anlegen' }));

    await waitFor(() => expect(feld()).toHaveValue(''));
    await waitFor(() => expect(feld()).toHaveFocus());
  });

  it('nach abgelehntem Speichern bleibt der Text stehen', async () => {
    // Die eigentliche Begruendung fuer den `mutateAsync`-Vertrag: haette das
    // Primitiv nach dem Aufruf blind geleert, waere die Eingabe weg, obwohl der
    // Eintrag nie ankam.
    const anlegen = vi.fn().mockRejectedValue(new Error('Speichern fehlgeschlagen'));
    renderZeile(anlegen);

    await userEvent.type(feld(), 'Sanitäter');
    await userEvent.click(screen.getByRole('button', { name: 'Qualifikation anlegen' }));

    await waitFor(() => expect(anlegen).toHaveBeenCalledOnce());
    expect(feld()).toHaveValue('Sanitäter');
  });

  it('leert nicht, wenn waehrend des Speicherns weitergetippt wurde', async () => {
    // Der Minutentakt-Fall aus dem Dateikopf: das Speichern haengt noch, die
    // naechste Eingabe steht schon im Feld. Ein unbedingtes Leeren im Erfolgsfall
    // — so macht es das Vorbild — friesse sie.
    let aufloesen!: () => void;
    const anlegen = vi.fn().mockReturnValue(new Promise<void>((r) => { aufloesen = r; }));
    renderZeile(anlegen);

    await userEvent.type(feld(), 'A');
    await userEvent.click(screen.getByRole('button', { name: 'Qualifikation anlegen' }));
    await waitFor(() => expect(anlegen).toHaveBeenCalledWith('A'));

    await userEvent.type(feld(), 'B');
    aufloesen();

    await waitFor(() => expect(feld()).toHaveFocus());
    expect(feld()).toHaveValue('AB');
  });

  it('waehrend der Mutation zeigt der Knopf eine Ladeanzeige', async () => {
    const { container } = renderZeile(vi.fn().mockResolvedValue(undefined), true);

    // antd haengt die Ladeanzeige als Klasse an den Knopf; ein Rollen-Griff
    // saehe sie nicht.
    expect(container.querySelector('.ant-btn-loading')).not.toBeNull();
  });
});
