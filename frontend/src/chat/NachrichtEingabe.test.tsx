import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
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
});
