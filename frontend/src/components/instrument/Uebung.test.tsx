import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
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

  it('klebt und meldet sich als Quelle des Rahmens', () => {
    render(<UebungsBand einsatz={UEBUNG} />);
    const band = document.querySelector<HTMLElement>('[data-lfh="uebung-band"]')!;
    expect(band.style.position).toBe('sticky');
    expect(band.style.top).toBe('0px');
    // jsdom misst 0 px Höhe; dass das Band sich meldet, belegt rahmenOben.test.tsx, das gerenderte
    // Kleben e2e/rahmen-stehen-bleiben.spec.ts.
    expect(leseRahmenOben()).toBe(0);
  });
});
