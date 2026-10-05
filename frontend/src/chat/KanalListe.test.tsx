import { describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderMitProviders } from '../test/utils';
import KanalListe, { sortiereKanaele } from './KanalListe';
import type { ChatKanal } from '../api/types';
import { AnzeigeKonventionenProvider } from '../anzeige/AnzeigeKonventionenContext';
import { mitProzessZone } from '../test/prozessZone';

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
    // Am Element MIT der Rolle, sonst wäre die Schaltfläche für Vorleser nie „aktuell".
    const aktiv = screen.getByRole('button', { current: true });
    expect(aktiv).toHaveTextContent('S2/S3');
    expect(screen.getAllByRole('button', { current: false })).not.toContain(aktiv);
    for (const zeile of document.querySelectorAll('[data-lfh="kanal-zeile"]')) {
      expect(zeile).not.toHaveAttribute('aria-current');
    }
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
  it('behält Name und Beschreibung, wenn die Anlage abgelehnt wird (LFH-795)', async () => {
    const user = userEvent.setup();
    const onKanalAnlegen = vi.fn(() => Promise.reject(new Error('409')));
    renderMitProviders(
      <KanalListe
        kanaele={[]}
        aktiverKanalId={null}
        onWechsel={vi.fn()}
        darfSchreiben
        onKanalAnlegen={onKanalAnlegen}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Kanal anlegen' }));
    await user.type(await screen.findByLabelText('Name'), 'Allgemein');
    await user.type(screen.getByLabelText('Beschreibung (optional)'), 'Doppelt');
    await user.click(screen.getByRole('button', { name: 'Anlegen' }));
    await waitFor(() => expect(onKanalAnlegen).toHaveBeenCalledWith('Allgemein', 'Doppelt'));
    // Dialog bleibt offen, die Eingaben stehen noch.
    expect(screen.getByRole('dialog')).not.toHaveClass('ant-zoom-leave');
    expect(screen.getByLabelText('Name')).toHaveValue('Allgemein');
    expect(screen.getByLabelText('Beschreibung (optional)')).toHaveValue('Doppelt');
  });

  it('schliesst und leert die Anlage erst nach Erfolg (LFH-795)', async () => {
    const user = userEvent.setup();
    let erfuellen!: () => void;
    const onKanalAnlegen = vi.fn(() => new Promise<void>((r) => (erfuellen = r)));
    renderMitProviders(
      <KanalListe
        kanaele={[]}
        aktiverKanalId={null}
        onWechsel={vi.fn()}
        darfSchreiben
        onKanalAnlegen={onKanalAnlegen}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Kanal anlegen' }));
    await user.type(await screen.findByLabelText('Name'), 'Abschnitt Nord');
    await user.click(screen.getByRole('button', { name: 'Anlegen' }));
    await waitFor(() => expect(onKanalAnlegen).toHaveBeenCalledTimes(1));
    // Noch nicht bestätigt: Dialog offen, Wert steht.
    expect(screen.getByLabelText('Name')).toHaveValue('Abschnitt Nord');
    await act(async () => erfuellen());
    // Zu = Ausblend-Animation läuft (jsdom beendet sie nicht).
    await waitFor(() => expect(screen.getByRole('dialog')).toHaveClass('ant-zoom-leave'));
    // Wieder geöffnet: leer.
    await user.click(screen.getByRole('button', { name: 'Kanal anlegen' }));
    expect(await screen.findByLabelText('Name')).toHaveValue('');
  });
});

/** LFH-913 (Spec `zeiteingabe`): die Zeit der letzten Nachricht steht in der Anzeigezone. */
describe('KanalListe — Zeit in der Anzeigezone (LFH-913)', () => {
  mitProzessZone('UTC');

  it('letzte Nachricht um 10:00 UTC steht als Berliner 1200 da', () => {
    renderMitProviders(
      <AnzeigeKonventionenProvider konventionen={{ zeitzone: 'Europe/Berlin' }}>
        <KanalListe
          kanaele={[kanal({ letzte_nachricht_at: '2026-06-10 10:00:00' })]}
          aktiverKanalId={1}
          onWechsel={vi.fn()}
          darfSchreiben={false}
          onKanalAnlegen={vi.fn()}
        />
      </AnzeigeKonventionenProvider>,
    );
    expect(screen.getByTitle('Letzte Nachricht')).toHaveTextContent('101200');
  });
});
