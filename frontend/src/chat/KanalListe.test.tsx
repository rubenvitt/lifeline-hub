import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderMitProviders } from '../test/utils';
import KanalListe, { sortiereKanaele } from './KanalListe';
import type { ChatKanal } from '../api/types';

function kanal(over: Partial<ChatKanal> = {}): ChatKanal {
  return {
    id: 1, einsatz_id: 7, name: 'Allgemein', beschreibung: null,
    letzte_nachricht_at: null, ungelesen_anzahl: 0,
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

  it('wechselt den Kanal mit Enter über die Auswahlzeile', async () => {
    const user = userEvent.setup();
    const onWechsel = vi.fn();
    renderMitProviders(
      <KanalListe kanaele={[kanal(), kanal({ id: 2, name: 'S2/S3' })]} aktiverKanalId={1}
        onWechsel={onWechsel} darfSchreiben onKanalAnlegen={vi.fn()} />,
    );

    const kanalZeile = screen.getByRole('button', { name: /S2\/S3/ });
    kanalZeile.focus();
    await user.keyboard('{Enter}');

    expect(onWechsel).toHaveBeenCalledWith(2);
    expect(onWechsel).toHaveBeenCalledTimes(1);
  });

  it('blendet "Kanal anlegen" für Nicht-Schreibberechtigte aus', () => {
    renderMitProviders(
      <KanalListe kanaele={[kanal()]} aktiverKanalId={1} onWechsel={vi.fn()}
        darfSchreiben={false} onKanalAnlegen={vi.fn()} />,
    );
    expect(screen.queryByRole('button', { name: 'Kanal' })).not.toBeInTheDocument();
  });

  it('zeigt Ungelesen-Punkt und letzte Nachrichtenzeit', () => {
    const letzte = new Date().toISOString().slice(0, 10) + ' 10:42:00';
    const { container } = renderMitProviders(
      <KanalListe
        kanaele={[kanal({ ungelesen_anzahl: 2, letzte_nachricht_at: letzte })]}
        aktiverKanalId={1}
        onWechsel={vi.fn()}
        darfSchreiben={false}
        onKanalAnlegen={vi.fn()}
      />,
    );
    expect(container.querySelector('.ant-badge-dot')).not.toBeNull();
    expect(screen.getByTitle('Letzte Nachricht')).not.toHaveTextContent('');
  });

  it('sortiert ungelesene Kanäle unabhängig von der Anlagezeit nach oben', () => {
    const sortiert = sortiereKanaele([
      kanal({ id: 1, name: 'Gelesen', ungelesen_anzahl: 0, letzte_nachricht_at: '2026-08-06 12:00:00' }),
      kanal({ id: 2, name: 'Ungelesen', ungelesen_anzahl: 1, letzte_nachricht_at: '2026-08-06 10:00:00' }),
    ]);
    expect(sortiert.map((k) => k.name)).toEqual(['Ungelesen', 'Gelesen']);
  });
});
