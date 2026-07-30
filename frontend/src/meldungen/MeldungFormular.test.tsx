import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { App as AntApp } from 'antd';
import MeldungFormular from './MeldungFormular';

/**
 * `onAnlegen` gibt seit LFH-332/B4 eine Zusage zurück — die Erfassungshülle
 * wartet darauf. Ein `vi.fn()` ohne Auflösung wäre `undefined` und damit ein
 * anderer Vertrag als der echte Aufrufer (`mutateAsync`).
 */
function anlegenMock() {
  return vi.fn<(d: unknown) => Promise<unknown>>().mockResolvedValue(undefined);
}

function renderFormular(onAnlegen = anlegenMock()) {
  render(
    <AntApp>
      <MeldungFormular senden={false} onAnlegen={onAnlegen} />
    </AntApp>,
  );
  return onAnlegen;
}

/** Die beiden Pflichtfelder füllen (Absender, Wortlaut). */
async function fuellePflichtfelder(absender: string, inhalt: string) {
  await userEvent.type(screen.getByLabelText('Absender'), absender);
  await userEvent.type(screen.getByLabelText('Inhalt / Wortlaut'), inhalt);
}

describe('MeldungFormular', () => {
  it('Fast-Path-Button belegt Sofortmeldung + Bestätigungspflicht vor', async () => {
    const onAnlegen = renderFormular();
    await userEvent.click(screen.getByRole('button', { name: /Sofortmeldung/ }));
    await fuellePflichtfelder('RTW 2', 'MANV');
    await userEvent.click(screen.getByRole('button', { name: 'Meldung erfassen' }));
    expect(onAnlegen).toHaveBeenCalledWith(expect.objectContaining({
      meldungsart: 'sofortmeldung', prioritaet: 'sofort', bestaetigung_pflicht: true,
    }));
  });

  it('reicht das Frist-Override in Minuten durch', async () => {
    const onAnlegen = renderFormular();
    // Bestätigungspflicht aktivieren, dann Frist-Override setzen.
    await userEvent.click(screen.getByRole('switch', { name: 'Bestätigung erforderlich' }));
    await userEvent.type(screen.getByLabelText('Bestätigungsfrist in Minuten'), '30');
    await fuellePflichtfelder('RTW 2', 'MANV');
    await userEvent.click(screen.getByRole('button', { name: 'Meldung erfassen' }));
    expect(onAnlegen).toHaveBeenCalledWith(expect.objectContaining({
      bestaetigung_pflicht: true, bestaetigung_frist_min: 30,
    }));
  });

  it('Lagemeldung-Fast-Path belegt meldungsart + richtung extern vor', async () => {
    const onAnlegen = renderFormular();
    await userEvent.click(screen.getByRole('button', { name: /Lagemeldung \(extern\)/ }));
    await fuellePflichtfelder('S3', 'Lage: ...');
    await userEvent.click(screen.getByRole('button', { name: 'Meldung erfassen' }));
    expect(onAnlegen).toHaveBeenCalledWith(expect.objectContaining({
      meldungsart: 'lagemeldung', richtung: 'extern',
    }));
  });

  it('sendet ohne Pflicht keine Frist', async () => {
    const onAnlegen = renderFormular();
    await fuellePflichtfelder('RTW 2', 'Lage ruhig');
    await userEvent.click(screen.getByRole('button', { name: 'Meldung erfassen' }));
    expect(onAnlegen).toHaveBeenCalledWith(expect.objectContaining({
      bestaetigung_pflicht: false, bestaetigung_frist_min: undefined,
    }));
  });

  // --- LFH-332/B4: Serienerfassung, Wertübernahme, Fehlschlag ---

  it('zählt die Serie und leert den Wortlaut nach „Speichern und nächste"', async () => {
    const onAnlegen = renderFormular();
    await fuellePflichtfelder('RTW 2', 'Erste Meldung');
    await userEvent.click(screen.getByRole('button', { name: 'Speichern und nächste' }));
    await waitFor(() => expect(onAnlegen).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/Erfasst: 1/)).toBeInTheDocument();
    // Der Wortlaut ist KEIN Wiederholfeld — er würde die nächste Meldung verfälschen.
    expect(screen.getByLabelText('Inhalt / Wortlaut')).toHaveValue('');
  });

  it('übernimmt Absender, Meldeweg und Empfänger in die nächste Meldung', async () => {
    const onAnlegen = renderFormular();
    await userEvent.type(screen.getByPlaceholderText('z. B. ELW 1, S3'), 'ELW 1');
    // Meldeweg vom Default (Funk) wegdrehen, damit die Übernahme beweisbar ist.
    await userEvent.click(screen.getByRole('combobox', { name: 'Meldeweg' }));
    await userEvent.click(await screen.findByText('Telefon'));
    await fuellePflichtfelder('RTW 2', 'Erste Meldung');
    // Der Schalter steht per Vorgabe AUS (30.07.2026) — die Übernahme ist eine
    // bewusste Wahl, kein Verhalten, in das man hineinläuft.
    await userEvent.click(screen.getByRole('checkbox', { name: 'Werte behalten' }));
    await userEvent.click(screen.getByRole('button', { name: 'Speichern und nächste' }));
    await waitFor(() => expect(onAnlegen).toHaveBeenCalledTimes(1));

    // Die drei Wiederholfelder stehen noch im Formular …
    expect(screen.getByLabelText('Absender')).toHaveValue('RTW 2');
    expect(screen.getByPlaceholderText('z. B. ELW 1, S3')).toHaveValue('ELW 1');
    // … und gehen unverändert in die zweite Meldung, ohne erneute Eingabe.
    await userEvent.type(screen.getByLabelText('Inhalt / Wortlaut'), 'Zweite Meldung');
    await userEvent.click(screen.getByRole('button', { name: 'Speichern und nächste' }));
    await waitFor(() => expect(onAnlegen).toHaveBeenCalledTimes(2));
    expect(onAnlegen.mock.calls[1][0]).toMatchObject({
      absender: 'RTW 2', empfaenger: 'ELW 1', meldeweg: 'telefon', inhalt: 'Zweite Meldung',
    });
  });

  it('leert ohne den Schalter auch die Wiederholfelder', async () => {
    const onAnlegen = renderFormular();
    await userEvent.type(screen.getByPlaceholderText('z. B. ELW 1, S3'), 'ELW 1');
    await fuellePflichtfelder('RTW 2', 'Erste Meldung');
    // Kein Klick auf „Werte behalten": das ist der unangetastete Vorgabezustand.
    await userEvent.click(screen.getByRole('button', { name: 'Speichern und nächste' }));
    await waitFor(() => expect(onAnlegen).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText('Absender')).toHaveValue('');
    expect(screen.getByPlaceholderText('z. B. ELW 1, S3')).toHaveValue('');
    expect(screen.getByLabelText('Inhalt / Wortlaut')).toHaveValue('');
  });

  it('lässt den Wortlaut stehen, wenn das Senden fehlschlägt', async () => {
    // Der Bestand setzte synchron nach dem Aufruf zurück (fire-and-forget) — der
    // Wortlaut war trotz Fehler-Toast weg. `onAnlegen` lehnt jetzt ab, die Hülle
    // fängt die Ablehnung und leert nichts.
    const onAnlegen = anlegenMock().mockRejectedValue(new Error('Netz weg'));
    renderFormular(onAnlegen);
    await fuellePflichtfelder('RTW 2', 'Wichtiger Wortlaut');
    await userEvent.click(screen.getByRole('button', { name: 'Meldung erfassen' }));
    await waitFor(() => expect(onAnlegen).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText('Inhalt / Wortlaut')).toHaveValue('Wichtiger Wortlaut');
    expect(screen.getByLabelText('Absender')).toHaveValue('RTW 2');
    // Ein Fehlschlag zählt nicht mit.
    expect(screen.queryByText(/Erfasst:/)).not.toBeInTheDocument();
  });
});
