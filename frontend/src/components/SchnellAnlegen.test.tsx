import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderMitProviders } from '../test/utils';
import SchnellAnlegen from './SchnellAnlegen';

/**
 * Die Zusicherungen von `SchnellAnlegen` (LFH-332 · B4).
 *
 * Keine Höhen und Trefflächen: `renderMitProviders` montiert ein nacktes `ConfigProvider`, eine
 * Pixel-Zusicherung bewiese nur antds Voreinstellung.
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

/** Das Feld wird über SEINE BESCHRIFTUNG gegriffen — das prüft `<label for>` ↔ `id` mit. Ein
 *  Griff per Platzhalter wäre auch ohne zugänglichen Namen grün. */
const feld = () => screen.getByLabelText('Neue Qualifikation');

describe('SchnellAnlegen', () => {
  it('Enter im Feld legt an — mit beschnittenem Text', async () => {
    const anlegen = vi.fn().mockResolvedValue(undefined);
    renderZeile(anlegen);

    // Die Leerzeichen sind Teil der Zusicherung: der Aufrufer bekommt den beschnittenen Wert.
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
    // … dann Leerzeichen, über BEIDE Wege: sonst bliebe die Prüfung grün, wenn nur der Klick-Zweig
    // den Wert beschnitte.
    await userEvent.type(feld(), '   {Enter}');
    await userEvent.click(screen.getByRole('button', { name: 'Qualifikation anlegen' }));

    expect(anlegen).not.toHaveBeenCalled();
  });

  it('nach Erfolg ist das Feld leer und traegt wieder den Fokus', async () => {
    const anlegen = vi.fn().mockResolvedValue(undefined);
    renderZeile(anlegen);

    await userEvent.type(feld(), 'Sanitäter');
    // Über den KNOPF: nur so verlässt der Fokus das Feld, mit Enter wäre die Fokus-Zusicherung
    // trivial grün.
    await userEvent.click(screen.getByRole('button', { name: 'Qualifikation anlegen' }));

    await waitFor(() => expect(feld()).toHaveValue(''));
    await waitFor(() => expect(feld()).toHaveFocus());
  });

  it('nach abgelehntem Speichern bleibt der Text stehen', async () => {
    // Der Grund für den `mutateAsync`-Vertrag: blind geleert, wäre die Eingabe weg, obwohl der
    // Eintrag nie ankam.
    const anlegen = vi.fn().mockRejectedValue(new Error('Speichern fehlgeschlagen'));
    renderZeile(anlegen);

    await userEvent.type(feld(), 'Sanitäter');
    await userEvent.click(screen.getByRole('button', { name: 'Qualifikation anlegen' }));

    await waitFor(() => expect(anlegen).toHaveBeenCalledOnce());
    expect(feld()).toHaveValue('Sanitäter');
  });

  it('leert nicht, wenn waehrend des Speicherns weitergetippt wurde', async () => {
    // Das Speichern hängt noch, die nächste Eingabe steht schon im Feld; ein unbedingtes Leeren im
    // Erfolgsfall fräße sie.
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

    // antd hängt die Ladeanzeige als Klasse an den Knopf; ein Rollen-Griff sähe sie nicht.
    expect(container.querySelector('.ant-btn-loading')).not.toBeNull();
  });

  /**
   * `gesperrt` (LFH-346): die Zeile steht gesperrt da, statt zu verschwinden. Beide Hälften
   * gehören zusammen: ohne die Sperr-Aussage wäre „legt nichts an" auch mit versteckter Zeile
   * grün, ohne „legt nichts an" wäre die Sperre eine reine Färbung.
   */
  it('gesperrt: Feld UND Knopf sind gesperrt', () => {
    renderZeile(vi.fn().mockResolvedValue(undefined), false, true);

    expect(feld()).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Qualifikation anlegen' })).toBeDisabled();
  });

  it('gesperrt legt auf KEINEM der beiden Wege an', async () => {
    const anlegen = vi.fn().mockResolvedValue(undefined);
    // Erst OFFEN rendern und tippen, dann sperren — sonst KANN die Prüfung nicht scheitern: in ein
    // gesperrtes Feld lässt sich nichts tippen, und bei leerem Text steigt `anlegen()` schon an der
    // Leer-Bedingung aus. Der Fall ist echt: das Recht kann beim Neuladen von `auth/me` wegfallen.
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
    // `pointer-events: none` gibt und userEvent den Klick sonst nicht absetzt.
    await userEvent.click(screen.getByRole('button', { name: 'Qualifikation anlegen' }), {
      pointerEventsCheck: 0,
    });

    // Weg 2, Enter im Feld — der tragende: `onPressEnter` hängt am `keydown` des Feldes und
    // erreicht den React-Handler auch gesperrt, während ein gesperrter Knopf den Klick schon selbst
    // verwirft. Deshalb sitzt der Riegel in `anlegen()`.
    fireEvent.keyDown(feld(), { key: 'Enter', code: 'Enter', keyCode: 13 });

    expect(anlegen).not.toHaveBeenCalled();
  });
});
