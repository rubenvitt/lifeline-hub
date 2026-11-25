import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import HelferWeichePage from './HelferWeichePage';

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});

/** Weiche `/helfer` im Browser (Helfer-App, Spec „Oberfläche“). */
describe('HelferWeichePage (Helfer-App)', () => {
  it('öffnet die App mit dem Code aus dem Fragment und löst ihn nicht ein', () => {
    const abruf = vi.spyOn(globalThis, 'fetch');
    window.history.replaceState(null, '', '/helfer#ABCD2345');
    render(<HelferWeichePage />);

    const link = screen.getByRole('link', { name: 'In Lifeline Helfer öffnen' });
    expect(link).toHaveAttribute(
      'href',
      `lifeline-helfer://anmelden?server=${window.location.origin}#ABCD2345`,
    );
    expect(screen.getByText('ABCD-2345')).toBeInTheDocument();
    expect(screen.getByText('iPhone: über TestFlight')).toBeInTheDocument();
    expect(screen.getByText('Android: APK von der Lifeline-Releaseseite')).toBeInTheDocument();
    // Kein Abruf, und der Code bleibt im Fragment.
    expect(abruf).not.toHaveBeenCalled();
    expect(window.location.hash).toBe('#ABCD2345');
  });

  it('bietet ohne Code keinen App-Link an', () => {
    window.history.replaceState(null, '', '/helfer');
    render(<HelferWeichePage />);
    expect(screen.queryByRole('link', { name: 'In Lifeline Helfer öffnen' })).toBeNull();
    expect(screen.getByText(/QR-Code erneut scannen/)).toBeInTheDocument();
  });
});
