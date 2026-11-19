import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import HilfeKnopf from './HilfeKnopf';

const hilfe = vi.hoisted(() => ({ oeffneHilfe: undefined as undefined | (() => void) }));
vi.mock('./HilfeSeitenleisteProvider', () => ({
  useHilfeSeitenleiste: () => ({ oeffneHilfe: hilfe.oeffneHilfe }),
}));

describe('HilfeKnopf', () => {
  it('öffnet die Hilfe zur Seite', () => {
    const oeffne = vi.fn();
    hilfe.oeffneHilfe = oeffne;
    render(<HilfeKnopf />);
    const knopf = screen.getByRole('button', { name: 'Hilfe zu dieser Seite' });
    expect(knopf).toHaveAttribute('aria-keyshortcuts', '? F1');
    fireEvent.click(knopf);
    expect(oeffne).toHaveBeenCalledWith('seite');
  });

  it('beschriftet zeigt den Wortlaut und ruft vorher onVorOeffnen', () => {
    const oeffne = vi.fn();
    const vorher = vi.fn();
    hilfe.oeffneHilfe = oeffne;
    render(<HilfeKnopf beschriftet onVorOeffnen={vorher} />);
    fireEvent.click(screen.getByText('Hilfe zu dieser Seite'));
    expect(vorher).toHaveBeenCalled();
    expect(oeffne).toHaveBeenCalled();
  });

  it('fehlt, wo es keine Hilfe-Leiste gibt', () => {
    hilfe.oeffneHilfe = undefined;
    const { container } = render(<HilfeKnopf />);
    expect(container).toBeEmptyDOMElement();
  });
});
