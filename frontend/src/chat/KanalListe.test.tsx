import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderMitProviders } from '../test/utils';
import KanalListe, { sortiereKanaele } from './KanalListe';
import type { ChatKanal } from '../api/types';

function kanal(over: Partial<ChatKanal> = {}): ChatKanal {
  return {
    id: 1,
    einsatz_id: 7,
    name: 'Allgemein',
    beschreibung: null,
    letzte_nachricht_at: null,
    ungelesen_anzahl: 0,
    erstellt_von_id: 1,
    erstellt_at: '2026-06-10 09:00:00',
    archiviert_at: null,
    ...over,
  };
}

describe('KanalListe', () => {
  it('zeigt Kanäle und meldet Wechsel', async () => {
    const onWechsel = vi.fn();
    renderMitProviders(
      <KanalListe
        kanaele={[kanal(), kanal({ id: 2, name: 'S2/S3' })]}
        aktiverKanalId={1}
        onWechsel={onWechsel}
        darfSchreiben
        onKanalAnlegen={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByText('S2/S3'));
    expect(onWechsel).toHaveBeenCalledWith(2);
  });

  it('wechselt den Kanal mit Enter über die Auswahlzeile', async () => {
    const user = userEvent.setup();
    const onWechsel = vi.fn();
    renderMitProviders(
      <KanalListe
        kanaele={[kanal(), kanal({ id: 2, name: 'S2/S3' })]}
        aktiverKanalId={1}
        onWechsel={onWechsel}
        darfSchreiben
        onKanalAnlegen={vi.fn()}
      />,
    );

    const kanalZeile = screen.getByRole('button', { name: /S2\/S3/ });
    kanalZeile.focus();
    await user.keyboard('{Enter}');

    expect(onWechsel).toHaveBeenCalledWith(2);
    expect(onWechsel).toHaveBeenCalledTimes(1);
  });

  it('blendet "Kanal anlegen" für Nicht-Schreibberechtigte aus', () => {
    renderMitProviders(
      <KanalListe
        kanaele={[kanal()]}
        aktiverKanalId={1}
        onWechsel={vi.fn()}
        darfSchreiben={false}
        onKanalAnlegen={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Kanal anlegen' })).not.toBeInTheDocument();
  });

  it('zeigt die Zahl der Ungelesenen (Zahl + Wort) und die letzte Nachrichtenzeit', () => {
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
    // Zweiter Kanal: die Zahl mit dem Wort, nicht bloß ein Farbpunkt.
    expect(container.querySelector('[data-lfh="kanal-ungelesen"]')).toHaveTextContent(
      '2 ungelesen',
    );
    expect(screen.getByTitle('Letzte Nachricht')).not.toHaveTextContent('');
  });

  it('sortiert ungelesene Kanäle unabhängig von der Anlagezeit nach oben', () => {
    const sortiert = sortiereKanaele([
      kanal({
        id: 1,
        name: 'Gelesen',
        ungelesen_anzahl: 0,
        letzte_nachricht_at: '2026-08-06 12:00:00',
      }),
      kanal({
        id: 2,
        name: 'Ungelesen',
        ungelesen_anzahl: 1,
        letzte_nachricht_at: '2026-08-06 10:00:00',
      }),
    ]);
    expect(sortiert.map((k) => k.name)).toEqual(['Ungelesen', 'Gelesen']);
  });

  it('markiert den aktiven Kanal mit aria-current', () => {
    renderMitProviders(
      <KanalListe
        kanaele={[kanal(), kanal({ id: 2, name: 'S2/S3' })]}
        aktiverKanalId={2}
        onWechsel={vi.fn()}
        darfSchreiben={false}
        onKanalAnlegen={vi.fn()}
      />,
    );
    const zeilen = Array.from(document.querySelectorAll('[data-lfh="kanal-zeile"]'));
    expect(zeilen.map((z) => z.getAttribute('aria-current'))).toEqual([null, 'true']);
  });

  it('legt einen Kanal per Enter im Namensfeld an (Erfassungs-Hülle)', async () => {
    const user = userEvent.setup();
    const onKanalAnlegen = vi.fn();
    renderMitProviders(
      <KanalListe
        kanaele={[]}
        aktiverKanalId={null}
        onWechsel={vi.fn()}
        darfSchreiben
        onKanalAnlegen={onKanalAnlegen}
      />,
    );
    // Leerzustand nennt den Weg; die Anlage öffnet aus dem Kopf.
    expect(screen.getByText(/Noch keine Kanäle/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Kanal anlegen' }));
    const name = await screen.findByLabelText('Name');
    await user.type(name, '  Abschnitt Nord  {Enter}');
    await waitFor(() => expect(onKanalAnlegen).toHaveBeenCalledWith('Abschnitt Nord', undefined));
  });
});
