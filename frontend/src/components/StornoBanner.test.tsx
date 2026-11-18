import { render, screen } from '@testing-library/react';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { describe, expect, it } from 'vitest';
import type { AnzeigeKonventionen } from '../anzeige/format';
import { StornoBanner, stornoText } from './StornoBanner';

dayjs.extend(utc);

const konv: AnzeigeKonventionen = { zeitzone: 'Europe/Berlin', zeitdarstellung: 'datum_uhrzeit' };
const JETZT = dayjs.utc('2026-10-10 16:00:00');

describe('stornoText (LLH-1832, Spec storno-sperre)', () => {
  it('nennt Name und Uhrzeit, wenn heute storniert', () => {
    expect(
      stornoText(
        { storniert_at: '2026-10-10 12:32:00', storniert_von_name: 'Anna Beispiel' },
        konv,
        JETZT,
      ),
    ).toBe('Storniert von Anna Beispiel um 14:32');
  });

  it('nennt den Tag, wenn an einem anderen Tag storniert', () => {
    expect(
      stornoText(
        { storniert_at: '2026-10-09 12:32:00', storniert_von_name: 'Anna Beispiel' },
        konv,
        JETZT,
      ),
    ).toBe('Storniert von Anna Beispiel am 09.10. 14:32');
  });

  it('lässt den Namen weg, wenn unbekannt (Altbestand)', () => {
    expect(
      stornoText({ storniert_at: '2026-10-10 12:32:00', storniert_von_name: null }, konv, JETZT),
    ).toBe('Storniert um 14:32');
  });

  it('liefert nichts ohne Storno', () => {
    expect(stornoText({ storniert_at: null, storniert_von_name: null }, konv, JETZT)).toBeNull();
  });
});

describe('StornoBanner', () => {
  it('steht als Statusmeldung', () => {
    render(
      <StornoBanner stand={{ storniert_at: '2026-10-10 12:32:00', storniert_von_name: 'A' }} />,
    );
    const banner = screen.getByRole('status');
    expect(banner.textContent).toMatch(/^Storniert von A (um|am) /);
    expect(banner.closest('[data-lfh="storno-banner"]')).not.toBeNull();
  });

  it('rendert ohne Storno nichts', () => {
    const { container } = render(<StornoBanner stand={undefined} />);
    expect(container.innerHTML).toBe('');
  });
});
