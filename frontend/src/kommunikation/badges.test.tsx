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

  it('zeigt ✓ Quittiert mit von + lokaler Zeit', () => {
    const am = '2026-06-11 09:00:00';
    const zeit = dayjs.utc(am).local().format('DD.MM.YYYY HH:mm');
    render(<QuittungIndikator quittiert von="EA Nord" am={am} />);
    expect(screen.getByText(`✓ Quittiert von EA Nord ${zeit}`)).toBeInTheDocument();
  });
});
