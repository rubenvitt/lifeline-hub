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
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ q: 'pumpe' })),
    );
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

  /**
   * Der Typ ist seit dem Neuentwurf (S4) NICHT mehr Teil dieser Leiste — er steht als
   * Segmentleiste im Seitenkopf. Die Zusicherung „ein Nachläufer der Suchfrist
   * überschreibt den gewählten Typ nicht" lebt deshalb an der Nahtstelle: die Leiste meldet
   * nur IHRE Schlüssel, die Seite führt zusammen (`zeitachseModell.test.ts`,
   * `filterZusammenfuehren`; `EtbPage.test.tsx`, „Segment und Suche …").
   */
  it('meldet nur ihre eigenen Schlüssel — nie einen Typ, auch wenn einer in der URL stand', () => {
    vi.useFakeTimers();
    try {
      const onChange = vi.fn<(w: EtbFilterWerte) => void>();
      render(<EtbFilterleiste onChange={onChange} startWerte={{ typ: 'meldung' }} />);
      tippe(screen.getByPlaceholderText('Volltextsuche'), 'pum');
      act(() => {
        vi.advanceTimersByTime(400);
      });
      const letzte = onChange.mock.calls[onChange.mock.calls.length - 1][0];
      expect(letzte).toEqual({ q: 'pum' });
      // Schärfer als `toEqual` (das `undefined` übergeht): der Schlüssel `typ` fehlt ganz.
      expect(Object.keys(letzte)).not.toContain('typ');
      // Und es gibt keinen Typwähler mehr in der Leiste.
      expect(screen.queryByRole('combobox')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('meldet einen geleerten Suchbegriff als undefined, damit die Seite ihn entfernt', async () => {
    const onChange = vi.fn<(w: EtbFilterWerte) => void>();
    render(<EtbFilterleiste onChange={onChange} startWerte={{ q: 'x' }} />);
    await userEvent.clear(screen.getByPlaceholderText('Volltextsuche'));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const letzte = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    // Der Schlüssel MUSS drinstehen — fehlte er, behielte die Zusammenführung den alten Wert.
    expect(Object.keys(letzte)).toContain('q');
    expect(letzte.q).toBeUndefined();
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
    // Der Zeitwert kommt als UTC-Wire-String und muss als ORTSZEIT im Feld stehen.
    // Ohne die Umkehr aus `filterZeit.ts` stünde hier der Wert um den Zonenversatz
    // verschoben — der Fehlermodus, wegen dem die Leiste bis LFH-342 nicht hydrierte.
    expect(screen.getByPlaceholderText('von')).toHaveValue('2026-08-21 08:00:00');
  });

  it('mischt einen Anfangsstand mit einer späteren Änderung, statt ihn zu verwerfen', async () => {
    const onChange = vi.fn<(w: EtbFilterWerte) => void>();
    render(<EtbFilterleiste onChange={onChange} startWerte={{ von: '2026-08-21 06:00:00' }} />);
    await userEvent.type(screen.getByPlaceholderText('Volltextsuche'), 'x');
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith({ von: '2026-08-21 06:00:00', q: 'x' }),
    );
  });
});
