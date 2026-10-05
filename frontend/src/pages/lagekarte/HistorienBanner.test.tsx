import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AnzeigeKonventionenProvider } from '../../anzeige/AnzeigeKonventionenContext';
import { mitProzessZone } from '../../test/prozessZone';
import { HistorienBanner } from './HistorienBanner';

/** LFH-913 (Spec `zeiteingabe`): der Stand des Banners steht in der Anzeigezone. */
describe('HistorienBanner — Stand in der Anzeigezone (LFH-913)', () => {
  mitProzessZone('UTC');

  it('ein Stand von 08:00 UTC steht als Berliner 241000JUL2026 da', () => {
    render(
      <AnzeigeKonventionenProvider konventionen={{ zeitzone: 'Europe/Berlin' }}>
        <HistorienBanner
          standAt="2026-07-24 08:00:00"
          bezeichnung="Stand A"
          onZurueckAktuell={vi.fn()}
        />
      </AnzeigeKonventionenProvider>,
    );
    expect(screen.getByText('Stand A · 241000JUL2026')).toBeInTheDocument();
  });
});
