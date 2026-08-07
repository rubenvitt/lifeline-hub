import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { renderMitProviders } from '../test/utils';
import PersonErfassungModal, { type ErfassungsModus } from './PersonErfassungModal';

/**
 * Unit-Netz für die Personen-Schnellerfassung (LFH-332 · B4).
 *
 * Diese Maske hatte bis hierher KEINEN Unit-Test — der Absendeweg hing allein an der
 * e2e-Suite. Geprüft wird deshalb genau das, was die Hülle für diese Maske zusichert
 * (Fokus, Enter, Serienlauf) plus das, was nur diese Maske entscheidet: das Feldbudget.
 *
 * Was hier NICHT geprüft wird: Höhen, Trefflächen, Abstände. `renderMitProviders` hängt ein
 * nacktes `ConfigProvider` ohne Theme ein — eine Behauptung über Pixel bewiese hier nichts.
 */

/** Modal mit Standard-Zusagen; einzelne Rückrufe überschreibbar. */
function zeige(opts: { modus?: ErfassungsModus; onErfassen?: Mock; einsatzId?: number } = {}) {
  const onErfassen: Mock = opts.onErfassen ?? vi.fn().mockResolvedValue(undefined);
  const onFertig: Mock = vi.fn();
  const onCancel: Mock = vi.fn();
  const ansicht = renderMitProviders(
    <PersonErfassungModal
      einsatzId={opts.einsatzId ?? 1}
      modus={opts.modus ?? 'schnell'}
      isPending={false}
      onErfassen={onErfassen}
      onFertig={onFertig}
      onCancel={onCancel}
    />,
  );
  return { ...ansicht, onErfassen, onFertig, onCancel };
}

beforeEach(() => sessionStorage.clear());

/**
 * Anzahl der Formularfelder IM BAUM.
 *
 * Bewusst über die Anwesenheit von `.ant-form-item` und NICHT über gerechnete Sichtbarkeit:
 * `renderMitProviders` liefert kein Theme, und eine Zählung, die an `display: none` aus antds
 * Laufzeit-CSS hängt, prüfte am Ende, ob jsdom das Stylesheet angewandt hat. Anwesenheit im
 * Baum ist hier die schärfere Aussage — sie ist nur wahr, wenn die Zusatzfelder wirklich erst
 * beim Aufklappen entstehen (kein `forceRender`, siehe Dateikopf der Komponente).
 */
function feldZahl(): number {
  return screen.getByRole('dialog').querySelectorAll('.ant-form-item').length;
}

describe('PersonErfassungModal — Tastaturweg', () => {
  it('setzt den Fokus beim Öffnen auf das erste Feld', async () => {
    zeige();
    // Geschlecht ist ein Select — antd rendert dort ein echtes `<input>`, der Fokus
    // landet also im Suchfeld der Combobox.
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Geschlecht')));
  });

  it('Enter im letzten sichtbaren Eingabefeld sendet ab', async () => {
    const { onErfassen } = zeige();
    const nutzer = userEvent.setup();

    await nutzer.type(screen.getByLabelText('Antreffort'), 'Sammelstelle Süd');
    await nutzer.type(screen.getByLabelText('Name'), 'Mustermann{Enter}');

    await waitFor(() => expect(onErfassen).toHaveBeenCalledTimes(1));
    expect(onErfassen.mock.calls[0][0]).toMatchObject({
      antreff_ort: 'Sammelstelle Süd', name: 'Mustermann',
    });
  });
});

describe('PersonErfassungModal — Serienmodus', () => {
  it('„Speichern und nächste" hält offen, leert die Felder und fokussiert zurück auf Feld 1', async () => {
    const { onErfassen, onFertig } = zeige();
    const nutzer = userEvent.setup();

    await nutzer.type(screen.getByLabelText('Name'), 'Mustermann');
    await nutzer.click(screen.getByRole('button', { name: 'Speichern und nächste' }));

    await waitFor(() => expect(onErfassen).toHaveBeenCalledTimes(1));
    // Offen heißt: der Aufrufer wurde NICHT zum Schließen aufgefordert und der Dialog steht.
    expect(onFertig).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveValue(''));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Geschlecht')));
  });

  it('der Antreffort überlebt das Serien-Speichern (Kontext-Default)', async () => {
    // `uebernahme={['antreff_ort']}`: an einer Sammelstelle kommen zehn Personen vom
    // selben Ort. Der Beleg ist das Nebeneinander — Name leer, Antreffort steht.
    // Der Schalter steht per Vorgabe AUS (30.07.2026) und wird hier eingeschaltet.
    zeige();
    const nutzer = userEvent.setup();

    await nutzer.click(screen.getByRole('checkbox', { name: 'Werte behalten' }));
    await nutzer.type(screen.getByLabelText('Antreffort'), 'Sammelstelle Süd');
    await nutzer.type(screen.getByLabelText('Name'), 'Mustermann');
    await nutzer.click(screen.getByRole('button', { name: 'Speichern und nächste' }));

    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveValue(''));
    expect(screen.getByLabelText('Antreffort')).toHaveValue('Sammelstelle Süd');
    expect(sessionStorage.getItem('lfh:erfassung:1:person:antreff_ort')).toBe('Sammelstelle Süd');
  });

  it('der Primär-Knopf meldet stattdessen fertig', async () => {
    const { onFertig } = zeige();
    const nutzer = userEvent.setup();

    await nutzer.type(screen.getByLabelText('Name'), 'Mustermann');
    await nutzer.click(screen.getByRole('button', { name: 'Erfassen' }));

    await waitFor(() => expect(onFertig).toHaveBeenCalledTimes(1));
  });
});

describe('PersonErfassungModal — Feldbudget', () => {
  it('zeigt eingeklappt höchstens vier Felder — und nach dem Aufklappen mehr', async () => {
    zeige();
    const nutzer = userEvent.setup();

    expect(feldZahl()).toBeLessThanOrEqual(4);
    expect(screen.getByLabelText('Geschlecht')).toBeInTheDocument();
    expect(screen.getByLabelText('Geschätztes Alter (Jahre)')).toBeInTheDocument();
    expect(screen.getByLabelText('Antreffort')).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toBeInTheDocument();
    expect(screen.queryByLabelText('Vorname')).not.toBeInTheDocument();

    // Die zweite Hälfte: ohne sie wäre „höchstens vier" auch dann wahr, wenn es die
    // Zusatzfelder überhaupt nicht mehr gäbe.
    await nutzer.click(screen.getByRole('button', { name: /Weitere Angaben/ }));

    await waitFor(() => expect(screen.getByLabelText('Vorname')).toBeInTheDocument());
    expect(feldZahl()).toBeGreaterThan(4);
    expect(screen.getByLabelText('Notiz')).toBeInTheDocument();
  });

  it('Melder / Kontakt gibt es nur im Vermisst-Modus', async () => {
    const { unmount } = renderMitProviders(
      <PersonErfassungModal
        einsatzId={1}
        modus="vermisst" isPending={false}
        onErfassen={vi.fn().mockResolvedValue(undefined)} onFertig={vi.fn()} onCancel={vi.fn()}
      />,
    );
    const nutzer = userEvent.setup();
    await nutzer.click(screen.getByRole('button', { name: /Weitere Angaben/ }));
    await waitFor(() => expect(screen.getByLabelText('Melder / Kontakt')).toBeInTheDocument());
    unmount();

    zeige({ modus: 'betroffen' });
    await nutzer.click(screen.getByRole('button', { name: /Weitere Angaben/ }));
    await waitFor(() => expect(screen.getByLabelText('Vorname')).toBeInTheDocument());
    expect(screen.queryByLabelText('Melder / Kontakt')).not.toBeInTheDocument();
  });

  it('ein eingeklappt zurückgelassener Wert geht beim Absenden trotzdem mit', async () => {
    // DER BELEG FÜR DIE ENTSCHEIDUNG GEGEN `forceRender` (siehe Dateikopf der Komponente).
    // Die einzige Lage, in der ein Zusatzfeld überhaupt einen Wert tragen kann, ist: aufgeklappt,
    // getippt, wieder zugeklappt. Genau die wird hier gefahren. Bliebe der Wert dabei liegen,
    // wäre `forceRender` (und eine sichtbarkeitsgerechnete Feldzählung) unvermeidlich.
    const { onErfassen } = zeige();
    const nutzer = userEvent.setup();

    const kopf = screen.getByRole('button', { name: /Weitere Angaben/ });
    await nutzer.click(kopf);
    await waitFor(() => expect(screen.getByLabelText('Vorname')).toBeInTheDocument());
    await nutzer.type(screen.getByLabelText('Vorname'), 'Max');
    await nutzer.click(kopf);
    // Ohne diese Zeile bewiese der Fall nichts: wäre der zweite Klick wirkungslos, stünde der
    // Bereich noch offen und „der Wert geht mit" wäre der triviale Normalfall.
    await waitFor(() => expect(kopf).toHaveAttribute('aria-expanded', 'false'));

    await nutzer.type(screen.getByLabelText('Name'), 'Mustermann{Enter}');

    await waitFor(() => expect(onErfassen).toHaveBeenCalledTimes(1));
    expect(onErfassen.mock.calls[0][0]).toMatchObject({ name: 'Mustermann', vorname: 'Max' });
  });
});

describe('PersonErfassungModal — Ablehnung', () => {
  it('lässt den Wortlaut stehen, wenn das Speichern fehlschlägt', async () => {
    const onErfassen = vi.fn().mockRejectedValue(new Error('abgelehnt'));
    const { onFertig } = zeige({ onErfassen });
    const nutzer = userEvent.setup();

    await nutzer.type(screen.getByLabelText('Name'), 'Mustermann{Enter}');

    await waitFor(() => expect(onErfassen).toHaveBeenCalledTimes(1));
    expect(onFertig).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Name')).toHaveValue('Mustermann');
  });
});

describe('PersonErfassungModal — sitzungsweiter Antreffort', () => {
  it('merkt den Ort erst nach Erfolg und setzt ihn beim Wiederöffnen ein', async () => {
    const ersteAnsicht = zeige();
    const nutzer = userEvent.setup();

    await nutzer.type(screen.getByLabelText('Antreffort'), 'Sammelstelle Süd');
    await nutzer.type(screen.getByLabelText('Name'), 'Mustermann');
    await nutzer.click(screen.getByRole('button', { name: 'Erfassen' }));
    await waitFor(() => expect(ersteAnsicht.onErfassen).toHaveBeenCalledTimes(1));
    ersteAnsicht.unmount();

    zeige();
    await waitFor(() => expect(screen.getByLabelText('Antreffort')).toHaveValue('Sammelstelle Süd'));
    expect(screen.getByRole('checkbox', { name: 'Werte behalten' })).not.toBeChecked();
  });

  it('merkt einen Ort nach abgelehntem Speichern nicht', async () => {
    const ersteAnsicht = zeige({
      onErfassen: vi.fn().mockRejectedValue(new Error('abgelehnt')),
    });
    const nutzer = userEvent.setup();

    await nutzer.type(screen.getByLabelText('Antreffort'), 'Fehlerort');
    await nutzer.click(screen.getByRole('button', { name: 'Erfassen' }));
    await waitFor(() => expect(ersteAnsicht.onErfassen).toHaveBeenCalledTimes(1));
    ersteAnsicht.unmount();

    zeige();
    expect(screen.getByLabelText('Antreffort')).toHaveValue('');
  });

  it('merkt einen Ort nach Abbruch während des Speicherns nicht', async () => {
    let antwortFreigeben!: () => void;
    const antwort = new Promise<void>((resolve) => { antwortFreigeben = resolve; });
    const ansicht = zeige({ onErfassen: vi.fn(() => antwort) });

    await userEvent.type(screen.getByLabelText('Antreffort'), 'Abbruchort Person');
    await userEvent.type(screen.getByLabelText('Name'), 'Mustermann');
    await userEvent.click(screen.getByRole('button', { name: 'Erfassen' }));
    await waitFor(() => expect(ansicht.onErfassen).toHaveBeenCalledTimes(1));
    await userEvent.click(screen.getByRole('button', { name: /Close|Schliessen|Schließen/i }));
    await act(async () => { antwortFreigeben(); await antwort; });

    expect(ansicht.onCancel).toHaveBeenCalledTimes(1);
    expect(ansicht.onFertig).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('lfh:erfassung:1:person:antreff_ort')).toBeNull();
  });

  it('füllt den Sitzungsort nach ausgeschaltetem Serien-Reset nicht heimlich erneut ein', async () => {
    sessionStorage.setItem('lfh:erfassung:1:person:antreff_ort', 'Sammelstelle Süd');
    const { onErfassen } = zeige();
    const nutzer = userEvent.setup();

    await waitFor(() => expect(screen.getByLabelText('Antreffort')).toHaveValue('Sammelstelle Süd'));
    expect(screen.getByRole('checkbox', { name: 'Werte behalten' })).not.toBeChecked();
    await nutzer.type(screen.getByLabelText('Name'), 'Mustermann');
    await nutzer.click(screen.getByRole('button', { name: 'Speichern und nächste' }));

    await waitFor(() => expect(onErfassen).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText('Antreffort')).toHaveValue('');
    expect(screen.getByRole('checkbox', { name: 'Werte behalten' })).not.toBeChecked();
  });
});
