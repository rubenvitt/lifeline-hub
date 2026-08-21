import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { EtbFilterWerte } from '../api/etb';
import EtbFilterleiste from './EtbFilterleiste';

/**
 * Tippen unter Fake-Timern läuft über `fireEvent`, nicht über `userEvent` — gemessen:
 * `userEvent.type` kommt in dieser Kombination nicht voran und der Test endet im
 * 10-s-Timeout statt in einer Aussage. `fireEvent.change` ist synchron und braucht keine
 * Timer-Kooperation; die Entprellung selbst wird davon nicht berührt, sie hängt am
 * `onChange` des Feldes.
 */
function tippe(feld: HTMLElement, text: string) {
  let bisher = '';
  for (const zeichen of text) {
    bisher += zeichen;
    fireEvent.change(feld, { target: { value: bisher } });
  }
}

describe('EtbFilterleiste', () => {
  it('meldet einen Suchbegriff an onChange', async () => {
    const onChange = vi.fn<(w: EtbFilterWerte) => void>();
    render(<EtbFilterleiste onChange={onChange} />);
    await userEvent.type(screen.getByPlaceholderText('Volltextsuche'), 'pumpe');
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ q: 'pumpe' })));
  });

  /**
   * Entprellung der Volltextsuche (LFH-342 · C7, Befund M80).
   *
   * Der Befund war messbar: jedes Zeichen erzeugte einen eigenen Query-Key, zwölf
   * Zeichen also zwölf Abrufe über den ganzen Tagebuchbestand. Die Zusicherung ist
   * deshalb eine ZAHL, keine Anwesenheit.
   */
  it('entprellt die Volltextsuche — 13 Zeichen ergeben höchstens 2 Meldungen', () => {
    vi.useFakeTimers();
    try {
      const onChange = vi.fn<(w: EtbFilterWerte) => void>();
      render(<EtbFilterleiste onChange={onChange} />);
      tippe(screen.getByPlaceholderText('Volltextsuche'), 'brandausbruch');
      // Vor Ablauf der Frist ist nichts hinausgegangen — sonst wäre die Entprellung
      // bloß eine Verzögerung des LETZTEN Zeichens und die Zahl bliebe bei 13.
      expect(onChange).not.toHaveBeenCalled();
      act(() => {
        vi.advanceTimersByTime(400);
      });
      expect(onChange.mock.calls.length).toBeLessThanOrEqual(2);
      expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'brandausbruch' }));
    } finally {
      vi.useRealTimers();
    }
  });

  it('das Eingabefeld bleibt sofort reaktionsfähig, nur die Meldung wartet', () => {
    vi.useFakeTimers();
    try {
      render(<EtbFilterleiste onChange={vi.fn()} />);
      const feld = screen.getByPlaceholderText('Volltextsuche');
      tippe(feld, 'pum');
      // Der sichtbare Text hängt NICHT an der Frist. Hinge er daran, sähe die
      // Bedienung aus wie ein hängendes Feld.
      expect(feld).toHaveValue('pum');
    } finally {
      vi.useRealTimers();
    }
  });

  it('der Typfilter greift sofort, ohne auf die Entprellung zu warten', () => {
    vi.useFakeTimers();
    try {
      const onChange = vi.fn<(w: EtbFilterWerte) => void>();
      render(<EtbFilterleiste onChange={onChange} />);
      // Antds Select öffnet auf `mousedown`, nicht auf `click` — der echte
      // Options-Knoten wird danach geklickt (Hausmuster für antd-Auswahlfelder).
      // Kein `findByTitle`: dessen `waitFor` hängt an echten Timern und liefe unter
      // Fake-Timern in den Test-Timeout statt in eine Aussage (gemessen).
      fireEvent.mouseDown(screen.getByRole('combobox'));
      act(() => {
        vi.advanceTimersByTime(50); // antds Öffnungsanimation, nicht unsere Frist
      });
      fireEvent.click(screen.getByTitle('Meldung'));
      // Die Uhr steht seit dem Klick still: was jetzt gemeldet ist, wurde SOFORT
      // gemeldet. Eine Auswahl ändert sich nicht zeichenweise, die Frist hätte hier
      // nur Wartezeit ohne Nutzen erzeugt.
      expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ typ: 'meldung' }));
    } finally {
      vi.useRealTimers();
    }
  });

  it('eine laufende Suchfrist überschreibt den eben gewählten Typ nicht', () => {
    vi.useFakeTimers();
    try {
      const onChange = vi.fn<(w: EtbFilterWerte) => void>();
      render(<EtbFilterleiste onChange={onChange} startWerte={{ typ: 'meldung' }} />);
      tippe(screen.getByPlaceholderText('Volltextsuche'), 'pum');
      act(() => {
        vi.advanceTimersByTime(400);
      });
      // Der Nachläufer trägt BEIDE Achsen. Baute er auf einem Stand ohne den Typ
      // auf, fiele der Filter beim nächsten Tastendruck still zurück.
      expect(onChange).toHaveBeenLastCalledWith({ typ: 'meldung', q: 'pum' });
    } finally {
      vi.useRealTimers();
    }
  });

  /**
   * Hydrierung aus der URL (LFH-342 · C7). Die Leiste bleibt unkontrolliert — begründet
   * im Dateikopf —, nimmt ihren Anfangsstand aber aus `startWerte`.
   */
  it('zeigt einen aus der URL geladenen Filter an', () => {
    render(
      <EtbFilterleiste
        onChange={vi.fn()}
        startWerte={{ q: 'brand', typ: 'meldung', von: '2026-08-21 06:00:00' }}
      />,
    );
    expect(screen.getByPlaceholderText('Volltextsuche')).toHaveValue('brand');
    expect(screen.getByTitle('Meldung')).toBeInTheDocument();
    // Der Zeitwert kommt als UTC-Wire-String und muss als ORTSZEIT im Feld stehen.
    // Ohne die Umkehr aus `filterZeit.ts` stünde hier der Wert um den Zonenversatz
    // verschoben — der Fehlermodus, wegen dem die Leiste bis LFH-342 nicht hydrierte.
    expect(screen.getByPlaceholderText('von')).toHaveValue('2026-08-21 08:00:00');
  });

  it('mischt einen Anfangsstand mit einer späteren Änderung, statt ihn zu verwerfen', async () => {
    const onChange = vi.fn<(w: EtbFilterWerte) => void>();
    render(<EtbFilterleiste onChange={onChange} startWerte={{ typ: 'meldung' }} />);
    await userEvent.type(screen.getByPlaceholderText('Volltextsuche'), 'x');
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith({ typ: 'meldung', q: 'x' }));
  });
});
