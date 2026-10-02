import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderMitProviders } from '../../test/utils';
import { ApiError } from '../../api/client';
import { UPLOAD_MAX_GROESSE } from '../../api/upload';
import ErfassungsAnhangAblegenModal from './ErfassungsAnhangAblegenModal';

const legeAb = vi.fn<(datei: File) => Promise<{ id: number }>>();
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
  await vi.waitFor(() => expect(document.activeElement).toBe(knopf));
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

    await vi.waitFor(() => expect(legeAb).toHaveBeenCalledTimes(1));
    expect(legeAb).toHaveBeenCalledWith(expect.objectContaining({ name: 'erstes.jpg' }));
    await vi.waitFor(() => expect(within(d).queryByText('erstes.jpg')).not.toBeInTheDocument());
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
