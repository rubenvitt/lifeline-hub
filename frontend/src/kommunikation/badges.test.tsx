import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import StatusBadge from './StatusBadge';
import PrioBadge from './PrioBadge';
import QuittungIndikator from './QuittungIndikator';

dayjs.extend(utc);

describe('StatusBadge', () => {
  it('rendert das Label mit der Phasen-Farbe', () => {
    render(<StatusBadge phase="in_arbeit" label="In Bearbeitung" />);
    const tag = screen.getByText('In Bearbeitung');
    expect(tag).toBeInTheDocument();
    // antd-Tag-Farbe 'processing' → preset-Klasse
    expect(tag.closest('.ant-tag')).toHaveClass('ant-tag-processing');
  });

  it('färbt die Ausnahme-Phase rot (error)', () => {
    render(<StatusBadge phase="ausnahme" label="Abgelehnt" />);
    expect(screen.getByText('Abgelehnt').closest('.ant-tag')).toHaveClass('ant-tag-error');
  });

  it('hebt das unbearbeitete Etikett strukturell ab, nicht nur im Wortlaut', () => {
    const { rerender } = render(<StatusBadge phase="offen" label="Neu" unbearbeitet />);
    const neu = screen.getByText('Neu').closest('.ant-tag')!;
    expect(neu).toHaveClass('ant-tag-warning');
    // Zweiter Kanal neben der Farbe (WCAG 1.4.1): Gewicht UND Wortlaut.
    expect((neu as HTMLElement).style.fontWeight).toBe('600');

    rerender(<StatusBadge phase="offen" label="Gesichtet" />);
    const gesichtet = screen.getByText('Gesichtet').closest('.ant-tag')!;
    // Der Kern von H47: beide tragen die Phase `offen`. Ohne die Marke wären sie
    // an derselben Klasse und demselben Gewicht nicht zu unterscheiden.
    expect(gesichtet).not.toHaveClass('ant-tag-warning');
    expect((gesichtet as HTMLElement).style.fontWeight).toBe('');
  });
});

describe('PrioBadge', () => {
  it('rendert Sofort rot', () => {
    render(<PrioBadge prio="sofort" />);
    const tag = screen.getByText('Sofort');
    expect(tag.closest('.ant-tag')).toHaveClass('ant-tag-red');
  });
});

describe('QuittungIndikator', () => {
  it('zeigt „Quittung offen" wenn nicht quittiert', () => {
    render(<QuittungIndikator quittiert={false} />);
    expect(screen.getByText('Quittung offen')).toBeInTheDocument();
  });

  it('zeigt ✓ Quittiert mit von + taktischer DTG', () => {
    const am = '2026-06-11 09:00:00';
    const d = dayjs.utc(am).local();
    const zeit = `${d.format('DDHHmm')}JUN${d.format('YYYY')}`; // taktische DTG (LFH-141)
    render(<QuittungIndikator quittiert von="EA Nord" am={am} />);
    expect(screen.getByText(`✓ Quittiert von EA Nord ${zeit}`)).toBeInTheDocument();
  });
});
