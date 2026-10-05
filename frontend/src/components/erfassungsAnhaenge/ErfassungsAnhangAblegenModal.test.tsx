import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderMitProviders } from '../../test/utils';
import { ApiError, AusgangUnbekannt, NetzFehler, type UploadFortschritt } from '../../api/client';
import { UPLOAD_MAX_GROESSE } from '../../api/upload';
import ErfassungsAnhangAblegenModal from './ErfassungsAnhangAblegenModal';

const legeAb =
  vi.fn<(datei: File, onFortschritt: (f: UploadFortschritt) => void) => Promise<{ id: number }>>();
afterEach(() => vi.clearAllMocks());

function Rahmen({ hinweis }: { hinweis?: string }) {
  const [offen, setOffen] = useState(true);
  return (
    <>
      <button onClick={() => setOffen(true)}>Öffnen</button>
      <ErfassungsAnhangAblegenModal
        einsatzId={1}
        bezug="Schaden S-003"
        queryKey={['einsatz-schaden-anhaenge', 1, 3]}
        ablegen={legeAb}
        hinweis={hinweis}
        offen={offen}
        onSchliessen={() => setOffen(false)}
      />
    </>
  );
}

/** Der Dialog, NACHDEM sein Anfangsfokus sitzt (Muster `DokumentAblegenModal.test.tsx`). */
async function dialog(hinweis?: string) {
  renderMitProviders(<Rahmen hinweis={hinweis} />);
  const d = (await screen.findAllByRole('dialog'))[0];
  const knopf = within(d).getByRole('button', { name: /Datei wählen/ });
  await waitFor(() => expect(document.activeElement).toBe(knopf));
  return d;
}

const dateiInput = (d: HTMLElement) => d.querySelector<HTMLInputElement>('input[type="file"]')!;
const foto = (name = 'dach.jpg') => new File(['x'], name, { type: 'image/jpeg' });

describe('ErfassungsAnhangAblegenModal (LFH-21, LFH-758)', () => {
  it('Struktur der Erfassungs-Norm: Absendeknopf im <form>, keine Modal-Fußzeile', async () => {
    const d = await dialog();
    const knopf = within(d).getByRole('button', { name: 'Ablegen' });
    expect(document.querySelector('.ant-modal-footer')).toBeNull();
    expect(knopf.closest('form')).not.toBeNull();
    expect(knopf).toHaveAttribute('type', 'submit');
  });

  it('nennt den Besitzer im Titel', async () => {
    const d = await dialog();
    expect(within(d).getByText('Datei ablegen · Schaden S-003')).toBeInTheDocument();
  });

  it('zeigt einen Hinweis nur, wenn die Ablage einen trägt (UHS: Zugriffsprotokoll)', async () => {
    const d = await dialog('Jeder Abruf einer Datei wird protokolliert.');
    expect(within(d).getByText('Jeder Abruf einer Datei wird protokolliert.')).toBeInTheDocument();
  });

  it('ohne Hinweis keine leere Hinweiszeile', async () => {
    const d = await dialog();
    expect(d.querySelector('[data-lfh="ablage-hinweis"]')).toBeNull();
  });

  it('filtert den Dateidialog auf die Erfassungs-Allowlist', async () => {
    const d = await dialog();
    expect(dateiInput(d)).toHaveAttribute('accept', '.jpg,.jpeg,.png,.webp,.heic,.heif,.pdf');
  });

  it('Serien-Speichern hält den Dialog offen und leert das Feld', async () => {
    legeAb.mockResolvedValue({ id: 1 });
    const d = await dialog();
    await userEvent.upload(dateiInput(d), foto('erstes.jpg'));
    await userEvent.click(within(d).getByRole('button', { name: /Speichern und nächste/ }));

    await waitFor(() => expect(legeAb).toHaveBeenCalledTimes(1));
    expect(legeAb).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'erstes.jpg' }),
      expect.any(Function),
    );
    await waitFor(() => expect(within(d).queryByText('erstes.jpg')).not.toBeInTheDocument());
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('lässt die Auswahl bei Ablehnung stehen und zeigt den Grund IM Dialog', async () => {
    legeAb.mockRejectedValue(new ApiError(400, 'Dateityp text/plain ist nicht erlaubt'));
    const d = await dialog();
    await userEvent.upload(dateiInput(d), foto('dach.jpg'));
    await userEvent.click(within(d).getByRole('button', { name: 'Ablegen' }));

    const alarm = await within(d).findByRole('alert');
    expect(alarm).toHaveTextContent('Dateityp text/plain ist nicht erlaubt');
    expect(alarm.closest('.ant-message')).toBeNull();
    expect(within(d).getByText('dach.jpg')).toBeInTheDocument();
  });

  it('sendet eine zu große Datei gar nicht erst', async () => {
    const d = await dialog();
    const gross = foto('gross.jpg');
    Object.defineProperty(gross, 'size', { value: UPLOAD_MAX_GROESSE + 1 });
    await userEvent.upload(dateiInput(d), gross);
    await userEvent.click(within(d).getByRole('button', { name: 'Ablegen' }));
    expect(await within(d).findByText('Datei ist zu groß (25 MiB erlaubt)')).toBeInTheDocument();
    expect(legeAb).not.toHaveBeenCalled();
  });
});

/**
 * LFH-878 (Muster LFH-654): Fortschritt, Prüfphase und eine Fehlermeldung, die die Phase des
 * Abbruchs nennt — wie im Ablegen-Dialog der Dokumentenablage. `ablegen` ist gemockt; der Test
 * steuert den Rückruf.
 */
describe('ErfassungsAnhangAblegenModal — Rückmeldung beim Ablegen (LFH-878)', () => {
  /** Wartet, bis der Dialog seinen Inhalt abgeräumt hat (Muster `DokumentAblegenModal.test.tsx`). */
  async function warteBisDialogWeg() {
    await waitFor(() => {
      const modal = document.querySelector<HTMLElement>('.ant-modal');
      if (modal) {
        fireEvent.transitionEnd(modal);
        fireEvent.animationEnd(modal);
      }
      expect(screen.queryByRole('button', { name: /Datei wählen/ })).not.toBeInTheDocument();
    });
  }

  /** Öffnet den Dialog im bestehenden Rahmen erneut. */
  async function wiederOeffnen() {
    await userEvent.click(screen.getByRole('button', { name: 'Öffnen' }));
    const d = (await screen.findAllByRole('dialog'))[0];
    const knopf = within(d).getByRole('button', { name: /Datei wählen/ });
    await waitFor(() => expect(document.activeElement).toBe(knopf));
    return d;
  }

  async function starteAblage() {
    let melde: ((f: UploadFortschritt) => void) | undefined;
    let erfuellen!: (wert: { id: number }) => void;
    let ablehnen!: (e: unknown) => void;
    legeAb.mockImplementation((_datei, onFortschritt) => {
      melde = onFortschritt;
      return new Promise((res, rej) => {
        erfuellen = res;
        ablehnen = rej;
      });
    });
    const d = await dialog();
    await userEvent.upload(dateiInput(d), foto('dach.jpg'));
    await userEvent.click(within(d).getByRole('button', { name: 'Ablegen' }));
    await waitFor(() => expect(legeAb).toHaveBeenCalledTimes(1));
    const fortschritt = (f: UploadFortschritt) => act(() => melde!(f));
    return { d, fortschritt, erfuellen, ablehnen };
  }

  it('zeigt den Balken sofort nach dem Absenden, noch vor dem ersten Byte-Ereignis', async () => {
    const { d } = await starteAblage();
    const balken = await within(d).findByRole('progressbar', { name: 'Wird hochgeladen' });
    expect(balken).not.toHaveAttribute('aria-valuenow');
  });

  it('zeigt Prozent aus den Bytes, nie rückwärts, und sperrt „Ablegen“', async () => {
    const { d, fortschritt } = await starteAblage();
    fortschritt({ phase: 'senden', anteil: 0.4 });
    fortschritt({ phase: 'senden', anteil: 0.3 });
    const balken = await within(d).findByRole('progressbar', { name: 'Wird hochgeladen · 40 %' });
    expect(balken).toHaveAttribute('aria-valuenow', '40');
    expect(within(d).getByRole('button', { name: /Ablegen/ })).toHaveClass('ant-btn-loading');
  });

  it('wechselt nach dem letzten Byte auf „Datei wird geprüft“ ohne Zahl', async () => {
    const { d, fortschritt } = await starteAblage();
    fortschritt({ phase: 'senden', anteil: 1 });
    fortschritt({ phase: 'pruefen' });
    const balken = await within(d).findByRole('progressbar', { name: 'Datei wird geprüft' });
    expect(balken).not.toHaveAttribute('aria-valuenow');
    expect(within(d).queryByText(/%/)).not.toBeInTheDocument();
  });

  it('räumt den Fortschritt nach Erfolg: beim Wiederöffnen steht keiner mehr', async () => {
    const { d, fortschritt, erfuellen } = await starteAblage();
    fortschritt({ phase: 'pruefen' });
    await within(d).findByRole('progressbar', { name: 'Datei wird geprüft' });
    await act(async () => erfuellen({ id: 1 }));
    await warteBisDialogWeg();
    const neu = await wiederOeffnen();
    expect(within(neu).queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('ein abgebrochener Lauf schreibt nicht in die Anzeige des nächsten', async () => {
    const melder: ((f: UploadFortschritt) => void)[] = [];
    legeAb.mockImplementation((_datei, onFortschritt) => {
      melder.push(onFortschritt);
      return new Promise(() => undefined);
    });
    let d = await dialog();
    await userEvent.upload(dateiInput(d), foto('erstes.jpg'));
    await userEvent.click(within(d).getByRole('button', { name: 'Ablegen' }));
    await waitFor(() => expect(legeAb).toHaveBeenCalledTimes(1));
    await userEvent.click(within(d).getByRole('button', { name: 'Abbrechen' }));
    await warteBisDialogWeg();

    d = await wiederOeffnen();
    await userEvent.upload(dateiInput(d), foto('zweites.jpg'));
    await userEvent.click(within(d).getByRole('button', { name: /Ablegen/ }));
    await waitFor(() => expect(legeAb).toHaveBeenCalledTimes(2));
    act(() => melder[1]({ phase: 'senden', anteil: 0.1 }));
    // Die alte Übertragung läuft serverseitig weiter und meldet noch.
    act(() => melder[0]({ phase: 'pruefen' }));
    expect(
      await within(d).findByRole('progressbar', { name: 'Wird hochgeladen · 10 %' }),
    ).toBeInTheDocument();
    expect(within(d).queryByRole('progressbar', { name: 'Datei wird geprüft' })).toBeNull();
  });

  it('Leitung reißt beim Senden ab: „Nicht abgelegt“, Auswahl bleibt, kein Fortschritt', async () => {
    const { d, fortschritt, ablehnen } = await starteAblage();
    fortschritt({ phase: 'senden', anteil: 0.6 });
    await act(async () => ablehnen(new NetzFehler()));
    const alarm = await within(d).findByRole('alert');
    expect(alarm).toHaveTextContent('Nicht abgelegt');
    expect(alarm).toHaveTextContent('NICHT abgeschickt');
    expect(within(d).queryByRole('progressbar')).not.toBeInTheDocument();
    expect(within(d).getByText('dach.jpg')).toBeInTheDocument();
  });

  it('Antwort bleibt nach dem letzten Byte aus: „unklar, Liste prüfen“, nicht „nicht abgeschickt“', async () => {
    const { d, fortschritt, ablehnen } = await starteAblage();
    fortschritt({ phase: 'pruefen' });
    await act(async () => ablehnen(new AusgangUnbekannt()));
    const alarm = await within(d).findByRole('alert');
    expect(alarm).toHaveTextContent('Ablage unklar');
    expect(alarm).toHaveTextContent(/unklar/);
    expect(alarm).toHaveTextContent(/Liste prüfen/);
    expect(alarm).not.toHaveTextContent(/NICHT abgeschickt/);
  });
});
