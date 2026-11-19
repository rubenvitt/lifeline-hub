import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Input } from 'antd';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderMitProviders } from '../test/utils';
import { leerePraesenz, praesenzListener, type PraesenzSchluessel } from '../live/praesenz';
import * as praesenz from '../live/praesenz';
import { InlineAngabe, type InlineAngabeProps } from './InlineAngabe';
import { VermerkZeile } from './FeldVermerkAnzeige';

/**
 * Präsenz an der Einzelangabe (LLH-1946, Entwurf D5/D6): Lebenszeichen beim Öffnen und alle 15 s,
 * Ende beim Schließen, Aushängen und Verlassen der Seite; Hinweis „Wird gerade bearbeitet von …“
 * am geschlossenen und am offenen Feld; die Vermerkzeile weicht ihm.
 */

let ohneNetz = false;
vi.mock('../offline/verbindung', async (original) => ({
  ...(await original<typeof import('../offline/verbindung')>()),
  useOhneVerbindung: () => ohneNetz,
}));

const schluessel: PraesenzSchluessel = {
  einsatzId: 1,
  objekt: 'einsatz',
  felder: ['leitstellen_nr'],
};

function TextAngabe(p: Partial<InlineAngabeProps<string>>) {
  return (
    <InlineAngabe<string>
      etikett="Leitstellen-Nr."
      wert="ILS-1"
      anzeige="ILS-1"
      leer={(w) => w.trim() === ''}
      darfSchreiben
      onSpeichern={vi.fn().mockResolvedValue(undefined)}
      eingabe={({ feld, value, onChange }) => (
        <Input {...feld} value={value} onChange={(e) => onChange(e.target.value)} />
      )}
      {...p}
    />
  );
}

function fremdeBearbeitung(von = 'Anna') {
  const [[, listener]] = praesenzListener(1);
  act(() =>
    listener(
      new MessageEvent('praesenz', {
        data: JSON.stringify({
          einsatz_id: 1,
          eintraege: [
            {
              objekt: 'einsatz',
              felder: ['leitstellen_nr'],
              benutzer_id: 2,
              von,
              fenster: 'fremd',
            },
          ],
        }),
      }),
    ),
  );
}

let melde: ReturnType<typeof vi.spyOn>;
let beende: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  ohneNetz = false;
  melde = vi.spyOn(praesenz, 'meldePraesenz').mockResolvedValue(true);
  beende = vi.spyOn(praesenz, 'beendePraesenz').mockReturnValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  leerePraesenz(1);
});

describe('InlineAngabe · Präsenz melden', () => {
  it('meldet beim Öffnen und danach alle 15 s', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderMitProviders(<TextAngabe praesenz={schluessel} />);
    await user.click(screen.getByRole('button', { name: 'Leitstellen-Nr. bearbeiten' }));
    expect(melde).toHaveBeenCalledTimes(1);
    expect(melde).toHaveBeenLastCalledWith(schluessel);
    act(() => vi.advanceTimersByTime(15_000));
    expect(melde).toHaveBeenCalledTimes(2);
    act(() => vi.advanceTimersByTime(15_000));
    expect(melde).toHaveBeenCalledTimes(3);
  });

  it('beendet beim Abbrechen und beim Aushängen einer offenen Bearbeitung', async () => {
    const user = userEvent.setup();
    const { unmount } = renderMitProviders(<TextAngabe praesenz={schluessel} />);
    await user.click(screen.getByRole('button', { name: 'Leitstellen-Nr. bearbeiten' }));
    await user.click(
      screen.getByRole('button', { name: 'Bearbeitung von Leitstellen-Nr. abbrechen' }),
    );
    expect(beende).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Leitstellen-Nr. bearbeiten' }));
    unmount();
    expect(beende).toHaveBeenCalledTimes(2);
  });

  it('beendet beim Verlassen der Seite mit keepalive', async () => {
    const user = userEvent.setup();
    renderMitProviders(<TextAngabe praesenz={schluessel} />);
    await user.click(screen.getByRole('button', { name: 'Leitstellen-Nr. bearbeiten' }));
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    expect(beende).toHaveBeenCalledWith(schluessel, true);
  });

  it('hört auf zu melden, wenn der Server die Meldung ablehnt', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    melde.mockResolvedValue(false);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderMitProviders(<TextAngabe praesenz={schluessel} />);
    await user.click(screen.getByRole('button', { name: 'Leitstellen-Nr. bearbeiten' }));
    expect(melde).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(45_000);
    });
    expect(melde).toHaveBeenCalledTimes(1);
  });

  it('sendet ohne Netz nichts', async () => {
    ohneNetz = true;
    const user = userEvent.setup();
    renderMitProviders(<TextAngabe praesenz={schluessel} />);
    await user.click(screen.getByRole('button', { name: 'Leitstellen-Nr. bearbeiten' }));
    expect(melde).not.toHaveBeenCalled();
  });

  it('sendet ohne praesenz nichts', async () => {
    const user = userEvent.setup();
    renderMitProviders(<TextAngabe />);
    await user.click(screen.getByRole('button', { name: 'Leitstellen-Nr. bearbeiten' }));
    expect(melde).not.toHaveBeenCalled();
  });
});

describe('InlineAngabe · Präsenz zeigen', () => {
  it('zeigt den Hinweis am geschlossenen Feld, als Beschreibung des Wertknopfs, ohne Live-Region', () => {
    renderMitProviders(<TextAngabe praesenz={schluessel} />);
    fremdeBearbeitung();
    const hinweis = document.querySelector('[data-lfh="feld-praesenz"]');
    expect(hinweis).toHaveTextContent('Wird gerade bearbeitet von Anna');
    expect(hinweis).not.toHaveAttribute('role');
    expect(hinweis).not.toHaveAttribute('aria-live');
    expect(
      screen.getByRole('button', { name: 'Leitstellen-Nr. bearbeiten' }),
    ).toHaveAccessibleDescription('ILS-1 Wird gerade bearbeitet von Anna');
  });

  it('zeigt den Hinweis auch im offenen Feld', async () => {
    const user = userEvent.setup();
    renderMitProviders(<TextAngabe praesenz={schluessel} />);
    await user.click(screen.getByRole('button', { name: 'Leitstellen-Nr. bearbeiten' }));
    fremdeBearbeitung('Ben');
    expect(document.querySelector('[data-lfh="feld-praesenz"]')).toHaveTextContent(
      'Wird gerade bearbeitet von Ben',
    );
  });

  it('zeigt den Hinweis auch ohne Schreibrecht', () => {
    renderMitProviders(<TextAngabe praesenz={schluessel} darfSchreiben={false} />);
    fremdeBearbeitung();
    expect(document.querySelector('[data-lfh="feld-praesenz"]')).toHaveTextContent(
      'Wird gerade bearbeitet von Anna',
    );
  });

  it('ohne Netz kein Hinweis: der Stand ist dann nicht mehr verlässlich', () => {
    ohneNetz = true;
    renderMitProviders(<TextAngabe praesenz={schluessel} />);
    fremdeBearbeitung();
    expect(document.querySelector('[data-lfh="feld-praesenz"]')).toBeNull();
  });

  it('ohne fremde Bearbeitung kein Hinweis', () => {
    renderMitProviders(<TextAngabe praesenz={schluessel} />);
    expect(document.querySelector('[data-lfh="feld-praesenz"]')).toBeNull();
  });
});

describe('VermerkZeile · weicht der Präsenz', () => {
  const vermerk = { at: '2026-11-19 10:00:00', von: 'Cem' };

  it('zeigt den Vermerk ohne Präsenz und nichts, solange jemand bearbeitet', () => {
    renderMitProviders(<VermerkZeile vermerk={vermerk} praesenz={schluessel} />);
    expect(document.querySelector('[data-lfh="feld-vermerk"]')).toHaveTextContent(
      'Geändert von Cem',
    );
    fremdeBearbeitung();
    expect(document.querySelector('[data-lfh="feld-vermerk"]')).toBeNull();
  });
});
