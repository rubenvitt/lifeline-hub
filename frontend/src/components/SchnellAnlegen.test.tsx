import { fireEvent, screen, waitFor } from '@testing-library/react';
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

function renderZeile(
  onAnlegen: (text: string) => Promise<unknown>,
  laeuft = false,
  gesperrt = false,
) {
  return renderMitProviders(
    <SchnellAnlegen
      beschriftung="Neue Qualifikation"
      platzhalter="z. B. Sanitäter"
      knopfText="Qualifikation anlegen"
      onAnlegen={onAnlegen}
      laeuft={laeuft}
      gesperrt={gesperrt}
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
    const anlegen = vi.fn().mockReturnValue(
      new Promise<void>((r) => {
        aufloesen = r;
      }),
    );
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

  /**
   * `gesperrt` (LFH-346, Nacharbeit zu Befund M45). Die Zeile VERSCHWINDET nicht mehr,
   * wenn das Recht fehlt — sie steht gesperrt da. Beide Haelften gehoeren zusammen: ohne
   * die Sperr-Aussage waere „legt nichts an" auch mit einer versteckten Zeile gruen, und
   * ohne „legt nichts an" waere die Sperre eine reine Faerbung.
   */
  it('gesperrt: Feld UND Knopf sind gesperrt', () => {
    renderZeile(vi.fn().mockResolvedValue(undefined), false, true);

    expect(feld()).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Qualifikation anlegen' })).toBeDisabled();
  });

  it('gesperrt legt auf KEINEM der beiden Wege an', async () => {
    const anlegen = vi.fn().mockResolvedValue(undefined);
    // Erst OFFEN rendern und tippen, dann sperren. Der Umweg ist noetig, damit die
    // Pruefung ueberhaupt scheitern KANN: in ein gesperrtes Feld laesst sich nichts
    // tippen, und bei leerem Text steigt `anlegen()` schon an der Leer-Bedingung aus —
    // eine Zusicherung, die gegen ein leeres Feld prueft, waere ohne den Riegel ebenso
    // gruen (gemessen). Der Fall ist zudem echt: das Recht kann waehrend des Tippens
    // wegfallen, wenn `auth/me` neu geladen wird.
    const { rerender } = renderZeile(anlegen);
    await userEvent.type(feld(), 'Sanitäter');
    rerender(
      <SchnellAnlegen
        beschriftung="Neue Qualifikation"
        platzhalter="z. B. Sanitäter"
        knopfText="Qualifikation anlegen"
        onAnlegen={anlegen}
        gesperrt
      />,
    );
    expect(feld()).toHaveValue('Sanitäter');

    // Weg 1, der Knopf. `pointerEventsCheck: 0`, weil antd einem gesperrten Knopf
    // `pointer-events: none` gibt und userEvent den Klick sonst gar nicht erst absetzt.
    await userEvent.click(screen.getByRole('button', { name: 'Qualifikation anlegen' }), {
      pointerEventsCheck: 0,
    });

    // Weg 2, Enter im Feld — und der ist der Grund, warum der Riegel in `anlegen()`
    // sitzt und nicht am Knopf: `onPressEnter` haengt am `keydown` des Feldes, und ein
    // zugestellter Tastendruck erreicht dessen React-Handler. Per Mutationsprobe
    // belegt: mit auskommentiertem `if (gesperrt)` wird GENAU diese Zeile rot,
    // waehrend der Knopf-Weg oben gruen bleibt (ein gesperrter Knopf verwirft den
    // Klick schon von sich aus) — die Enter-Haelfte ist also die tragende.
    fireEvent.keyDown(feld(), { key: 'Enter', code: 'Enter', keyCode: 13 });

    expect(anlegen).not.toHaveBeenCalled();
  });
});
