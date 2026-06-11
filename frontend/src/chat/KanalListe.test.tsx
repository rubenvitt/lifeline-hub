import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderMitProviders } from '../test/utils';
import KanalListe from './KanalListe';
import type { ChatKanal } from '../api/types';

function kanal(over: Partial<ChatKanal> = {}): ChatKanal {
  return {
    id: 1, einsatz_id: 7, name: 'Allgemein', beschreibung: null,
    erstellt_von_id: 1, erstellt_at: '2026-06-10 09:00:00', archiviert_at: null, ...over,
  };
}

describe('KanalListe', () => {
  it('zeigt Kanäle und meldet Wechsel', async () => {
    const onWechsel = vi.fn();
    renderMitProviders(
      <KanalListe kanaele={[kanal(), kanal({ id: 2, name: 'S2/S3' })]} aktiverKanalId={1}
        onWechsel={onWechsel} darfSchreiben onKanalAnlegen={vi.fn()} />,
    );
    await userEvent.click(screen.getByText('S2/S3'));
    expect(onWechsel).toHaveBeenCalledWith(2);
  });

  it('blendet "Kanal anlegen" für Nicht-Schreibberechtigte aus', () => {
    renderMitProviders(
      <KanalListe kanaele={[kanal()]} aktiverKanalId={1} onWechsel={vi.fn()}
        darfSchreiben={false} onKanalAnlegen={vi.fn()} />,
    );
    expect(screen.queryByRole('button', { name: 'Kanal' })).not.toBeInTheDocument();
  });
});
