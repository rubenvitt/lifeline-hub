import { describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderMitProviders } from '../test/utils';
import NachrichtEingabe from './NachrichtEingabe';

describe('NachrichtEingabe', () => {
  it('sendet getrimmten Text und leert das Feld', async () => {
    const onSenden = vi.fn();
    renderMitProviders(<NachrichtEingabe onSenden={onSenden} senden={false} />);
    const feld = screen.getByPlaceholderText('Nachricht…');
    await userEvent.type(feld, '  Lagebild aktualisiert  ');
    await userEvent.click(screen.getByRole('button', { name: 'Senden' }));
    expect(onSenden).toHaveBeenCalledWith('Lagebild aktualisiert', []);
  });

  it('leert Text und Anhänge erst nach erfolgreichem Senden (LFH-795)', async () => {
    let erfuellen!: () => void;
    const onSenden = vi.fn(() => new Promise<void>((r) => (erfuellen = r)));
    renderMitProviders(<NachrichtEingabe onSenden={onSenden} senden={false} />);
    const feld = screen.getByPlaceholderText('Nachricht…');
    await userEvent.type(feld, 'Lagebild');
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, new File(['PDF'], 'lage.pdf', { type: 'application/pdf' }));
    await userEvent.click(screen.getByRole('button', { name: 'Senden' }));
    // Solange das Senden läuft, steht alles noch da.
    expect(feld).toHaveValue('Lagebild');
    expect(screen.getByTitle('lage.pdf')).toBeInTheDocument();
    await act(async () => erfuellen());
    expect(feld).toHaveValue('');
    await waitFor(() => expect(screen.queryByTitle('lage.pdf')).not.toBeInTheDocument());
  });

  it('behält Text und Anhänge, wenn das Senden abgelehnt wird (LFH-795)', async () => {
    const onSenden = vi.fn(() => Promise.reject(new Error('413')));
    renderMitProviders(<NachrichtEingabe onSenden={onSenden} senden={false} />);
    const feld = screen.getByPlaceholderText('Nachricht…');
    await userEvent.type(feld, 'Lagebild');
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, new File(['PDF'], 'lage.pdf', { type: 'application/pdf' }));
    await userEvent.click(screen.getByRole('button', { name: 'Senden' }));
    await waitFor(() => expect(onSenden).toHaveBeenCalledTimes(1));
    expect(feld).toHaveValue('Lagebild');
    expect(screen.getByTitle('lage.pdf')).toBeInTheDocument();
  });

  it('sendet nicht doppelt, solange das Senden läuft (LFH-795)', async () => {
    // Der Text bleibt bis zum Erfolg stehen; ein zweites Enter darf ihn nicht erneut schicken.
    let erfuellen!: () => void;
    const onSenden = vi.fn(() => new Promise<void>((r) => (erfuellen = r)));
    renderMitProviders(<NachrichtEingabe onSenden={onSenden} senden={false} />);
    const feld = screen.getByPlaceholderText('Nachricht…');
    await userEvent.type(feld, 'Lagebild{Enter}');
    await userEvent.type(feld, '{Enter}');
    expect(onSenden).toHaveBeenCalledTimes(1);
    await act(async () => erfuellen());
    expect(feld).toHaveValue('');
  });

  it('verwirft keinen Nachtrag, der während des Sendens dazukam (LFH-795)', async () => {
    // Offline pausiert die Mutation; wer währenddessen weiterschreibt oder anhängt, darf das nach
    // dem Erfolg nicht verlieren. Geleert wird nur, was gesendet wurde.
    let erfuellen!: () => void;
    const onSenden = vi.fn(() => new Promise<void>((r) => (erfuellen = r)));
    renderMitProviders(<NachrichtEingabe onSenden={onSenden} senden={false} />);
    const feld = screen.getByPlaceholderText('Nachricht…');
    // rc-upload ersetzt sein Datei-Input nach jeder Wahl, deshalb je Upload neu abfragen.
    const dateiInput = () => document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.type(feld, 'A');
    await userEvent.upload(dateiInput(), new File(['1'], 'lage.pdf', { type: 'application/pdf' }));
    await userEvent.click(screen.getByRole('button', { name: 'Senden' }));
    await userEvent.type(feld, ', Nachtrag');
    await userEvent.upload(dateiInput(), new File(['2'], 'foto.jpg', { type: 'image/jpeg' }));
    expect(await screen.findByTitle('foto.jpg')).toBeInTheDocument();
    await act(async () => erfuellen());
    expect(feld).toHaveValue('A, Nachtrag');
    await waitFor(() => expect(screen.queryByTitle('lage.pdf')).not.toBeInTheDocument());
    expect(screen.getByTitle('foto.jpg')).toBeInTheDocument();
  });

  it('sendet nicht bei leerem Text ohne Anhang', async () => {
    const onSenden = vi.fn();
    renderMitProviders(<NachrichtEingabe onSenden={onSenden} senden={false} />);
    await userEvent.click(screen.getByRole('button', { name: 'Senden' }));
    expect(onSenden).not.toHaveBeenCalled();
  });

  it('sendet einen Anhang auch ohne Text mit', async () => {
    const onSenden = vi.fn();
    renderMitProviders(<NachrichtEingabe onSenden={onSenden} senden={false} />);
    const datei = new File(['PDF'], 'lage.pdf', { type: 'application/pdf' });
    // Upload-Komponente rendert ein verstecktes file-input.
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, datei);
    await userEvent.click(screen.getByRole('button', { name: 'Senden' }));
    expect(onSenden).toHaveBeenCalledTimes(1);
    const [text, dateien] = onSenden.mock.calls[0];
    expect(text).toBe('');
    expect(dateien).toHaveLength(1);
    expect((dateien[0] as File).name).toBe('lage.pdf');
  });

  it('macht den Dateinamen eines Anhangs ohne Vorschau nicht zum Tab-Stopp (LFH-657)', async () => {
    // Wie im `DateiFeld`: ohne `onPreview` bedient der Name nichts, also kein Tab-Stopp.
    renderMitProviders(<NachrichtEingabe onSenden={vi.fn()} senden={false} />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, new File(['PDF'], 'lage.pdf', { type: 'application/pdf' }));
    const liste = document.querySelector<HTMLElement>('.ant-upload-list')!;
    const name = await within(liste).findByTitle('lage.pdf');
    expect(name).not.toHaveAttribute('role');
    expect(name).not.toHaveAttribute('tabindex');
  });
});
