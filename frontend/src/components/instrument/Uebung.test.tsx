import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { leseRahmenOben } from '../rahmenOben';
import { UebungsBand, UebungsMarke } from './Uebung';

const UEBUNG = { einsatzart: 'uebung' as const };
const REAL = { einsatzart: 'realeinsatz' as const };

describe('UebungsMarke (LLH-1725, Spec `uebungsmarke`)', () => {
  it('zeigt bei einer Übung das Wort ÜBUNG', () => {
    render(<UebungsMarke einsatz={UEBUNG} />);
    expect(screen.getByText('Übung')).toBeInTheDocument();
    // Versalien sind CSS: Vorleser lesen „Übung“, nicht „Ü-B-U-N-G“.
    expect(screen.getByText('Übung')).toHaveStyle({ textTransform: 'uppercase' });
  });

  it.each([
    ['Realeinsatz', REAL],
    ['ladender Einsatz', undefined],
  ])('steht bei %s nicht da', (_fall, einsatz) => {
    const { container } = render(<UebungsMarke einsatz={einsatz} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('trägt auf dem Lagemonitor mindestens 28 px', () => {
    render(<UebungsMarke einsatz={UEBUNG} groesse="monitor" />);
    const px = Number.parseFloat(getComputedStyle(screen.getByText('Übung')).fontSize);
    expect(px).toBeGreaterThanOrEqual(28);
  });
});

describe('UebungsBand (LLH-1725, Spec `uebungsmarke`)', () => {
  it('zeigt bei einer Übung das Band mit dem Wort ÜBUNG', () => {
    render(<UebungsBand einsatz={UEBUNG} />);
    const band = document.querySelector('[data-lfh="uebung-band"]');
    expect(band).not.toBeNull();
    expect(band).toHaveTextContent('Übung');
  });

  it.each([
    ['Realeinsatz', REAL],
    ['ladender Einsatz', undefined],
  ])('steht bei %s nicht da, auch kein Platzhalter', (_fall, einsatz) => {
    const { container } = render(<UebungsBand einsatz={einsatz} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('nennt eine unbekannte Einsatzart, statt still nichts zu zeigen (LLH-1725)', () => {
    render(<UebungsBand einsatz={undefined} unbekannt klebend={false} />);
    const hinweis = document.querySelector('[data-lfh="uebung-unbekannt"]');
    expect(hinweis).toHaveTextContent('Einsatzart nicht geladen');
    // Kein Übungsband: die Art ist unbekannt, nicht „Übung“.
    expect(document.querySelector('[data-lfh="uebung-band"]')).toBeNull();
  });

  it('mit bekannter Art zählt die Art, nicht der Merker „unbekannt“', () => {
    render(<UebungsBand einsatz={REAL} unbekannt klebend={false} />);
    expect(document.querySelector('[data-lfh="uebung-unbekannt"]')).toBeNull();
  });

  /**
   * jsdom misst keine Höhe: `offsetHeight` am Prototyp gestubbt, damit „meldet sich“ und „meldet
   * sich nicht“ unterscheidbar sind. Das gerenderte Kleben misst e2e/rahmen-stehen-bleiben.spec.ts.
   */
  describe('als Quelle des Rahmens', () => {
    beforeEach(() => {
      vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(24);
    });
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('klebt und meldet seine Höhe (Einsatzrahmen)', () => {
      const { unmount } = render(<UebungsBand einsatz={UEBUNG} />);
      const band = document.querySelector<HTMLElement>('[data-lfh="uebung-band"]')!;
      expect(band.style.position).toBe('sticky');
      expect(band.style.top).toBe('0px');
      expect(leseRahmenOben()).toBe(24);
      unmount();
      expect(leseRahmenOben()).toBe(0);
    });

    it('nicht klebend steht es im Fluss und meldet keine Höhe (Gerätehülle, D7)', () => {
      render(<UebungsBand einsatz={UEBUNG} klebend={false} />);
      const band = document.querySelector<HTMLElement>('[data-lfh="uebung-band"]')!;
      expect(band.style.position).toBe('');
      expect(leseRahmenOben()).toBe(0);
    });
  });
});
