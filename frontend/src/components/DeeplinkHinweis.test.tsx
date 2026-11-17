import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { DeeplinkHinweisLage } from '../routing/useQueryParamSelektion';
import { renderMitProviders } from '../test/utils';
import { DeeplinkHinweis } from './DeeplinkHinweis';

const lage = (unbekannt: number | null, schliesse = vi.fn()): DeeplinkHinweisLage => ({
  unbekannt,
  melde: vi.fn(),
  schliesse,
});

/**
 * Hinweisleiste für einen Deeplink auf Unbekanntes (LLH-1827, Change `a12ms7g9-seitenzustaende`,
 * D5; Spec `seiten-zustaende`, „Deeplink auf ein Objekt, das es nicht gibt“).
 */
describe('DeeplinkHinweis', () => {
  it('nennt Sache und Kennung', () => {
    renderMitProviders(<DeeplinkHinweis lage={lage(99999)} sache="Meldung" />);
    expect(screen.getByText('Meldung #99999 gibt es nicht (mehr)')).toBeInTheDocument();
  });

  it('zeichnet ohne unbekannte Kennung nichts', () => {
    const { container } = renderMitProviders(<DeeplinkHinweis lage={lage(null)} sache="Meldung" />);
    expect(container.querySelector('[data-lfh="deeplink-hinweis"]')).toBeNull();
    expect(screen.queryByText(/gibt es nicht/)).not.toBeInTheDocument();
  });

  it('ist schließbar und räumt dabei die Lage', async () => {
    const schliesse = vi.fn();
    renderMitProviders(<DeeplinkHinweis lage={lage(7, schliesse)} sache="Fahrzeug" />);
    await userEvent.click(screen.getByRole('button', { name: 'Hinweis schließen' }));
    expect(schliesse).toHaveBeenCalledTimes(1);
  });

  it('ist ein Hinweis, kein Alarm: Typ info, keine Rolle alert, kein Toast', async () => {
    renderMitProviders(<DeeplinkHinweis lage={lage(7)} sache="Fahrzeug" />);
    await act(async () => {});
    const leiste = screen.getByText('Fahrzeug #7 gibt es nicht (mehr)').closest('.ant-alert');
    expect(leiste).toHaveClass('ant-alert-info');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Fahrzeug #7 gibt es nicht (mehr)');
    expect(document.querySelector('.ant-message')).toBeNull();
  });
});
