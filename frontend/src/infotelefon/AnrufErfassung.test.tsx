import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderMitProviders } from '../test/utils';
import { mitProzessZone } from '../test/prozessZone';
import { AnzeigeKonventionenProvider } from '../anzeige/AnzeigeKonventionenContext';
import { setzeViewportBreite, setzeZeigerGrob } from '../test/viewport';
import AnrufErfassung, { formularLeer } from './AnrufErfassung';

/** Anliegen wählen: das antd-Select öffnet per Klick, die Option ist ein `option`-Element. */
async function waehleAnliegen(label: string) {
  await userEvent.click(screen.getByLabelText('Anliegen'));
  await userEvent.click(await screen.findByTitle(label));
}

describe('AnrufErfassung (LFH-554)', () => {
  it('speichert per Enter, leert die Felder und steht wieder im Anliegen', async () => {
    const erfassen = vi.fn().mockResolvedValue({});
    renderMitProviders(<AnrufErfassung onErfassen={erfassen} laeuft={false} fehler={null} />);
    await waehleAnliegen('Auskunft zur Lage');
    await userEvent.type(screen.getByLabelText('Notiz'), 'Sperrung B 3{Enter}');
    await waitFor(() =>
      expect(erfassen).toHaveBeenCalledWith({
        anliegen: 'auskunft_lage',
        notiz: 'Sperrung B 3',
        anrufer_name: undefined,
        rueckruf: undefined,
        rueckruf_noetig: false,
      }),
    );
    await waitFor(() => expect(screen.getByLabelText('Notiz')).toHaveValue(''));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Anliegen')));
    expect(screen.getByText('1 erfasst')).toBeInTheDocument();
  });

  it('steht auch dann wieder im Anliegen, wenn ein Frame vor dem Neu-Einhängen läuft', async () => {
    // `resetFields` hängt jedes Feld neu ein. Unter CI-Last lief ein `requestAnimationFrame` vor
    // diesem Commit, der Fokus fiel auf `body`. Ein sofort laufender Frame stellt das nach.
    const erfassen = vi.fn().mockResolvedValue({});
    renderMitProviders(<AnrufErfassung onErfassen={erfassen} laeuft={false} fehler={null} />);
    await waehleAnliegen('Auskunft zur Lage');
    await userEvent.type(screen.getByLabelText('Notiz'), 'Sperrung B 3');
    const frame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0);
      return 0;
    });
    try {
      await userEvent.keyboard('{Enter}');
      await waitFor(() => expect(erfassen).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Anliegen')));
    } finally {
      frame.mockRestore();
    }
  });

  it('macht die Rückrufnummer mit „Rückruf nötig“ sichtbar und zur Pflicht', async () => {
    const erfassen = vi.fn().mockResolvedValue({});
    renderMitProviders(<AnrufErfassung onErfassen={erfassen} laeuft={false} fehler={null} />);
    // Eingeklappt steht die Nummer im DOM (forceRender), aber nicht sichtbar.
    expect(screen.getByLabelText('Rückrufnummer')).not.toBeVisible();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Rückruf nötig' }));
    const nummer = screen.getByLabelText('Rückrufnummer');
    expect(nummer).toBeVisible();
    await waehleAnliegen('Vermisstensuche');
    await userEvent.click(screen.getByRole('button', { name: 'Erfassen' }));
    expect(await screen.findByText('Für einen Rückruf erforderlich')).toBeInTheDocument();
    expect(erfassen).not.toHaveBeenCalled();
    await userEvent.type(nummer, '0171 000{Enter}');
    await waitFor(() =>
      expect(erfassen).toHaveBeenCalledWith(
        expect.objectContaining({ rueckruf: '0171 000', rueckruf_noetig: true }),
      ),
    );
  });

  it('lässt die Felder bei Ablehnung stehen und zeigt den Grund', async () => {
    const erfassen = vi.fn().mockRejectedValue(new Error('nein'));
    const { rerender } = renderMitProviders(
      <AnrufErfassung onErfassen={erfassen} laeuft={false} fehler={null} />,
    );
    await waehleAnliegen('Hinweis zur Lage');
    await userEvent.type(screen.getByLabelText('Notiz'), 'Baum auf Straße{Enter}');
    await waitFor(() => expect(erfassen).toHaveBeenCalled());
    expect(screen.getByLabelText('Notiz')).toHaveValue('Baum auf Straße');
    rerender(<AnrufErfassung onErfassen={erfassen} laeuft={false} fehler={new Error('nein')} />);
    expect(screen.getByText('Anruf nicht erfasst')).toBeInTheDocument();
  });
});

/** LFH-692 (Spec `zeiteingabe`): Browser auf UTC, Einsatz auf Europe/Berlin. */
describe('AnrufErfassung — Uhrzeit in der Anzeigezone (LFH-692)', () => {
  mitProzessZone('UTC');

  it('eine Uhrzeit 13:00 Berliner Zeit geht als 11:00 UTC hinaus', async () => {
    const erfassen = vi.fn().mockResolvedValue({});
    renderMitProviders(
      <AnzeigeKonventionenProvider konventionen={{ zeitzone: 'Europe/Berlin' }}>
        <AnrufErfassung onErfassen={erfassen} laeuft={false} fehler={null} />
      </AnzeigeKonventionenProvider>,
    );
    await waehleAnliegen('Auskunft zur Lage');
    await userEvent.click(screen.getByText('Anrufer und Uhrzeit'));
    const uhrzeit = screen.getByRole('textbox', { name: 'Uhrzeit' });
    await userEvent.click(uhrzeit);
    await userEvent.type(uhrzeit, '30.09.2026 13:00');
    await userEvent.keyboard('{Enter}');
    await waitFor(() =>
      expect(erfassen).toHaveBeenCalledWith(
        expect.objectContaining({ eingang_at: '2026-09-30 11:00:00' }),
      ),
    );
  });
});

describe('AnrufErfassung — Eingabegrenzen (LFH-937)', () => {
  it('zählt die Notiz erst ab 80 %; über 2 000 Zeichen bleibt sie ganz stehen und sperrt', async () => {
    const erfassen = vi.fn().mockResolvedValue({});
    renderMitProviders(<AnrufErfassung onErfassen={erfassen} laeuft={false} fehler={null} />);
    const notiz = screen.getByLabelText('Notiz');
    fireEvent.change(notiz, { target: { value: 'n'.repeat(1_599) } });
    expect(screen.queryByText(/\/ 2\.000/)).toBeNull();
    fireEvent.change(notiz, { target: { value: 'n'.repeat(1_600) } });
    expect(screen.getByText('1.600 / 2.000')).toBeInTheDocument();
    fireEvent.change(notiz, { target: { value: 'n'.repeat(2_001) } });
    expect(notiz).toHaveValue('n'.repeat(2_001));
    expect(screen.getByText('2.001 / 2.000 · zu lang')).toBeInTheDocument();
    await waehleAnliegen('Auskunft zur Lage');
    await userEvent.click(screen.getByRole('button', { name: 'Erfassen' }));
    expect(
      await screen.findByText('Notiz darf höchstens 2.000 Zeichen lang sein'),
    ).toBeInTheDocument();
    expect(erfassen).not.toHaveBeenCalled();
  });

  it('begrenzt Name und Rückrufnummer auf 200 Zeichen', () => {
    renderMitProviders(<AnrufErfassung onErfassen={vi.fn()} laeuft={false} fehler={null} />);
    expect(screen.getByLabelText('Name')).toHaveAttribute('maxlength', '200');
    expect(screen.getByLabelText('Rückrufnummer')).toHaveAttribute('maxlength', '200');
  });
});

/**
 * Zeigen statt erklären (LFH-1078): keine Tastenlegende als Satz, kein „Leer gelassen: jetzt“.
 * Enter sendet, weil der Knopf im `<form>` steht; das nennt `aria-keyshortcuts`, sichtbar nur eine
 * Kappe ab `lg` mit feinem Zeiger (Muster `etb/Schnellerfassung.tsx`).
 */
describe('AnrufErfassung — Kürzel und Uhrzeit ohne Erklärsatz (LFH-1078)', () => {
  it('nennt Enter am Knopf statt in einer Hinweiszeile', () => {
    renderMitProviders(<AnrufErfassung onErfassen={vi.fn()} laeuft={false} fehler={null} />);
    const knopf = screen.getByRole('button', { name: 'Erfassen' });
    expect(knopf).toHaveAttribute('aria-keyshortcuts', 'Enter');
    expect(knopf.querySelector('kbd')).toHaveTextContent('↵');
    const zeile = document.querySelector('[data-lfh="schnellerfassung"]')!;
    expect(zeile.textContent).not.toMatch(/Enter speichert|Tab wechselt/);
  });

  it('unter lg und mit grobem Zeiger keine Kappe; das Kürzel bleibt am Knopf', () => {
    setzeViewportBreite(820);
    const { unmount } = renderMitProviders(
      <AnrufErfassung onErfassen={vi.fn()} laeuft={false} fehler={null} />,
    );
    expect(screen.getByRole('button', { name: 'Erfassen' }).querySelector('kbd')).toBeNull();
    unmount();
    setzeViewportBreite(1280);
    setzeZeigerGrob(true);
    renderMitProviders(<AnrufErfassung onErfassen={vi.fn()} laeuft={false} fehler={null} />);
    const knopf = screen.getByRole('button', { name: 'Erfassen' });
    expect(knopf.querySelector('kbd')).toBeNull();
    expect(knopf).toHaveAttribute('aria-keyshortcuts', 'Enter');
  });

  it('die leere Uhrzeit zeigt „jetzt“ als Platzhalter, nicht als Satz', () => {
    renderMitProviders(<AnrufErfassung onErfassen={vi.fn()} laeuft={false} fehler={null} />);
    expect(screen.getByLabelText('Uhrzeit')).toHaveAttribute('placeholder', 'jetzt');
    expect(screen.queryByText(/Leer gelassen/)).toBeNull();
  });
});

describe('AnrufErfassung — eingeklappt (LFH-1067)', () => {
  const p = { onErfassen: vi.fn().mockResolvedValue({}), laeuft: false, fehler: null };

  it('zeigt eingeklappt nur Anliegen und „Erfassen“, aufgeklappt wieder alles', () => {
    const { rerender } = renderMitProviders(<AnrufErfassung {...p} einklappbar />);
    expect(screen.getByLabelText('Anliegen')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Erfassen/ })).toBeInTheDocument();
    expect(screen.queryByLabelText('Notiz')).not.toBeInTheDocument();
    expect(screen.queryByText('Rückruf nötig')).not.toBeInTheDocument();
    expect(screen.queryByText('Anrufer und Uhrzeit')).not.toBeInTheDocument();
    rerender(<AnrufErfassung {...p} einklappbar={false} />);
    expect(screen.getByLabelText('Notiz')).toBeInTheDocument();
    expect(screen.getByText('Anrufer und Uhrzeit')).toBeInTheDocument();
  });

  it('klappt mit Inhalt nicht ein: nichts Begonnenes verschwindet', async () => {
    const { rerender } = renderMitProviders(<AnrufErfassung {...p} einklappbar={false} />);
    await userEvent.type(screen.getByLabelText('Notiz'), 'Keller');
    rerender(<AnrufErfassung {...p} einklappbar />);
    expect(screen.getByLabelText('Notiz')).toHaveValue('Keller');
  });

  it('klappt mit Fehler nicht ein', () => {
    renderMitProviders(<AnrufErfassung {...p} fehler={new Error('weg')} einklappbar />);
    expect(screen.getByLabelText('Notiz')).toBeInTheDocument();
  });
});

describe('formularLeer', () => {
  it('zählt Leerzeichen nicht als Inhalt, jedes gesetzte Feld schon', () => {
    expect(formularLeer(undefined)).toBe(true);
    expect(formularLeer({ notiz: '  ', rueckruf_noetig: false })).toBe(true);
    expect(formularLeer({ anliegen: 'presse' })).toBe(false);
    expect(formularLeer({ notiz: 'x' })).toBe(false);
    expect(formularLeer({ rueckruf_noetig: true })).toBe(false);
    expect(formularLeer({ anrufer_name: 'A' })).toBe(false);
    expect(formularLeer({ rueckruf: '0171' })).toBe(false);
  });
});
