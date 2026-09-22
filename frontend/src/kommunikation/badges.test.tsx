import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import StatusBadge from './StatusBadge';
import PrioBadge from './PrioBadge';
import QuittungIndikator from './QuittungIndikator';

dayjs.extend(utc);

/** Der Statuschip um einen Wortlaut — `data-ton` trägt den Ton der getönten Fläche. */
const chip = (text: string) => screen.getByText(text).closest('[data-lfh="status-chip"]')!;

describe('StatusBadge', () => {
  it('rendert das Label als Statusfläche im Ton der Phase', () => {
    render(<StatusBadge phase="in_arbeit" label="In Bearbeitung" />);
    expect(screen.getByText('In Bearbeitung')).toBeInTheDocument();
    // Aktive Bearbeitung ist eine aktive Beziehung → `bedien` (Neuentwurf).
    expect(chip('In Bearbeitung')).toHaveAttribute('data-ton', 'bedien');
    expect(chip('In Bearbeitung').closest('[data-phase]')).toHaveAttribute(
      'data-phase',
      'in_arbeit',
    );
  });

  it('färbt die Ausnahme-Phase als Alarm', () => {
    render(<StatusBadge phase="ausnahme" label="Abgelehnt" />);
    expect(chip('Abgelehnt')).toHaveAttribute('data-ton', 'alarm');
  });

  it('hebt das unbearbeitete Etikett strukturell ab, nicht nur im Wortlaut', () => {
    const { rerender } = render(<StatusBadge phase="offen" label="Neu" unbearbeitet />);
    const neu = chip('Neu') as HTMLElement;
    expect(neu).toHaveAttribute('data-ton', 'achtung');
    // Zweiter Kanal neben der Farbe (WCAG 1.4.1): Gewicht UND Wortlaut.
    expect(neu.style.fontWeight).toBe('600');

    rerender(<StatusBadge phase="offen" label="Gesichtet" />);
    const gesichtet = chip('Gesichtet') as HTMLElement;
    // Der Kern von H47: beide tragen die Phase `offen`. Ohne die Marke wären sie
    // an demselben Ton und demselben Gewicht nicht zu unterscheiden.
    expect(gesichtet).toHaveAttribute('data-ton', 'neutral');
    expect(gesichtet.style.fontWeight).toBe('');
  });
});

describe('PrioBadge', () => {
  it('rendert Sofort als Alarm, Dringend als Achtung', () => {
    const { rerender } = render(<PrioBadge prio="sofort" />);
    expect(chip('Sofort')).toHaveAttribute('data-ton', 'alarm');
    rerender(<PrioBadge prio="dringend" />);
    expect(chip('Dringend')).toHaveAttribute('data-ton', 'achtung');
  });
});

describe('QuittungIndikator', () => {
  it('zeigt „Quittung offen" wenn nicht quittiert', () => {
    render(<QuittungIndikator quittiert={false} />);
    expect(screen.getByText('Quittung offen')).toBeInTheDocument();
    expect(chip('Quittung offen')).toHaveAttribute('data-ton', 'neutral');
  });

  it('zeigt ✓ Quittiert mit von + taktischer DTG', () => {
    const am = '2026-06-11 09:00:00';
    const d = dayjs.utc(am).local();
    const zeit = `${d.format('DDHHmm')}JUN${d.format('YYYY')}`; // taktische DTG (LFH-141)
    render(<QuittungIndikator quittiert von="EA Nord" am={am} />);
    expect(screen.getByText(`✓ Quittiert von EA Nord ${zeit}`)).toBeInTheDocument();
  });
});
