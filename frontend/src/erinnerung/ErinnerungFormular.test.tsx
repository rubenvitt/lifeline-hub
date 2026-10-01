import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderMitProviders } from '../test/utils';
import { AnzeigeKonventionenProvider } from '../anzeige/AnzeigeKonventionenContext';
import { mitProzessZone } from '../test/prozessZone';
import ErinnerungFormular from './ErinnerungFormular';
// Katalog und Besetzung stehen fest, statt über das Netz zu kommen (LFH-549).
vi.mock('../fuehrung/useFunktionsVorschlaege', async () => ({
  useFunktionsVorschlaege: (await import('../test/fuehrungsfunktionen')).vorschlaegeFuer,
}));

/** Der gewählte Wert des Empfängerfelds (Tag im Select). */
function gewaehlterEmpfaenger(): string | null | undefined {
  return document.querySelector('.ant-select-selection-item')?.textContent;
}

/** Serienerfassung: das Formular bleibt nach dem Speichern offen und hält die Wiederholfelder. */
describe('ErinnerungFormular — Serienerfassung', () => {
  it('bleibt nach dem Speichern offen, leert den Titel und behält die Wiederholfelder', async () => {
    const onAnlegen = vi.fn().mockResolvedValue({});
    renderMitProviders(<ErinnerungFormular card={false} senden={false} onAnlegen={onAnlegen} />);

    await userEvent.click(screen.getByRole('checkbox', { name: /Werte behalten/ }));
    await userEvent.type(screen.getByLabelText('Titel'), 'Lagemeldung aller EA');
    // Freitext bleibt Freitext (LFH-549): „S2“ ist kein Katalogwert, nur weil es so aussieht.
    await userEvent.type(screen.getByLabelText('Empfänger'), 'S2{enter}');
    await userEvent.click(screen.getByRole('button', { name: /Speichern und n/ }));

    await waitFor(() => expect(onAnlegen).toHaveBeenCalledTimes(1));
    expect(onAnlegen).toHaveBeenCalledWith(
      expect.objectContaining({ empfaenger_funktion: 'S2', empfaenger_funktion_code: undefined }),
    );
    // Der Anlass wechselt, der Adressat bleibt — das ist der Unterschied zwischen
    // „Formular offen lassen" und Serienerfassung.
    await waitFor(() => expect(screen.getByLabelText('Titel')).toHaveValue(''));
    expect(gewaehlterEmpfaenger()).toBe('S2');
  });

  it('nimmt einen Katalogwert als Code, nicht als Text (LFH-549)', async () => {
    const onAnlegen = vi.fn().mockResolvedValue({});
    renderMitProviders(
      <ErinnerungFormular card={false} senden={false} onAnlegen={onAnlegen} einsatzId={7} />,
    );

    await userEvent.type(screen.getByLabelText('Titel'), 'Lage');
    await userEvent.click(screen.getByLabelText('Empfänger'));
    await userEvent.click(await screen.findByText('S2 – Lage (Müller)'));
    await userEvent.click(screen.getByRole('button', { name: 'Anlegen' }));

    await waitFor(() => expect(onAnlegen).toHaveBeenCalledTimes(1));
    expect(onAnlegen).toHaveBeenCalledWith(
      expect.objectContaining({ empfaenger_funktion_code: 's2', empfaenger_funktion: undefined }),
    );
  });

  it('hält den Absende-Knopf im <form>, obwohl der Empfänger ein Select ist (Erfassungs-Norm)', () => {
    renderMitProviders(<ErinnerungFormular card={false} senden={false} onAnlegen={vi.fn()} />);
    // Ein Select schluckt Enter; gesendet wird dann nur über den Knopf im Formular.
    expect(screen.getByRole('button', { name: 'Anlegen' }).closest('form')).not.toBeNull();
    expect(document.querySelector('.ant-modal-footer')).toBeNull();
  });

  it('bietet Fachberater aus dem Tipptext als ausdrückliche Wahl an', async () => {
    const onAnlegen = vi.fn().mockResolvedValue({});
    renderMitProviders(
      <ErinnerungFormular card={false} senden={false} onAnlegen={onAnlegen} einsatzId={7} />,
    );

    await userEvent.type(screen.getByLabelText('Titel'), 'Lage');
    await userEvent.type(screen.getByLabelText('Empfänger'), 'THW');
    await userEvent.click(await screen.findByText('Fachberater: THW'));
    await userEvent.click(screen.getByRole('button', { name: 'Anlegen' }));

    await waitFor(() => expect(onAnlegen).toHaveBeenCalledTimes(1));
    expect(onAnlegen).toHaveBeenCalledWith(
      expect.objectContaining({
        empfaenger_funktion_code: 'fachberater',
        empfaenger_funktion: 'THW',
      }),
    );
  });

  it('lässt den Wortlaut stehen, wenn der Server ablehnt', async () => {
    const onAnlegen = vi.fn().mockRejectedValue(new Error('422'));
    renderMitProviders(<ErinnerungFormular card={false} senden={false} onAnlegen={onAnlegen} />);

    await userEvent.type(screen.getByLabelText('Titel'), 'Lagemeldung aller EA');
    await userEvent.click(screen.getByRole('button', { name: 'Anlegen' }));

    await waitFor(() => expect(onAnlegen).toHaveBeenCalled());
    // Ohne `mutateAsync` in der Kette wäre der Wortlaut trotz Fehler-Toast weg.
    expect(screen.getByLabelText('Titel')).toHaveValue('Lagemeldung aller EA');
  });
});

/** LFH-692 (Spec `zeiteingabe`): Browser auf UTC, Organisation auf Europe/Berlin. */
describe('ErinnerungFormular — Fälligkeit in der Anzeigezone (LFH-692)', () => {
  mitProzessZone('UTC');

  it('eine eingegebene 13:00 Berliner Zeit geht als 11:00 UTC hinaus', async () => {
    const onAnlegen = vi.fn().mockResolvedValue({});
    renderMitProviders(
      <AnzeigeKonventionenProvider konventionen={{ zeitzone: 'Europe/Berlin' }}>
        <ErinnerungFormular card={false} senden={false} onAnlegen={onAnlegen} />
      </AnzeigeKonventionenProvider>,
    );
    await userEvent.type(screen.getByLabelText('Titel'), 'Lage');
    const feld = screen.getByRole('textbox', { name: 'Fällig' });
    await userEvent.click(feld);
    await userEvent.clear(feld);
    await userEvent.type(feld, '2026-09-24 13:00');
    await userEvent.keyboard('{Enter}');
    await userEvent.click(screen.getByRole('button', { name: 'Anlegen' }));
    await waitFor(() =>
      expect(onAnlegen).toHaveBeenCalledWith(
        expect.objectContaining({ faellig_at: '2026-09-24 11:00:00' }),
      ),
    );
  });
});
