import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { farbenHell } from '../theme/tokens';
import KommKarte from './KommKarte';

const karte = (c: HTMLElement) => c.querySelector<HTMLElement>('[data-lfh="komm-karte"]')!;

describe('KommKarte — Kartenrand-Vertrag (LFH-343 · C8, H47)', () => {
  it('trägt Alarm als data-alarm und NICHT zusätzlich den Eingangszustand', () => {
    const { container } = render(
      <KommKarte alarm unbearbeitet>
        Inhalt
      </KommKarte>,
    );
    expect(karte(container)).toHaveAttribute('data-alarm', 'true');
    expect(karte(container)).not.toHaveAttribute('data-unbearbeitet');
  });

  it('trägt den Eingangszustand, wenn kein Alarm besteht', () => {
    const { container } = render(<KommKarte unbearbeitet>Inhalt</KommKarte>);
    expect(karte(container)).toHaveAttribute('data-unbearbeitet', 'true');
    expect(karte(container)).not.toHaveAttribute('data-alarm');
  });

  it('zeigt Zeit und Nummer in der Zeitspalte und reicht data-Attribute durch', () => {
    const { container } = render(
      <KommKarte data-meldung-id={5} zeit="14:02" nr="#12">
        Inhalt
      </KommKarte>,
    );
    expect(karte(container)).toHaveAttribute('data-meldung-id', '5');
    const spalte = container.querySelector('[data-lfh="komm-karte-zeit"]')!;
    expect(spalte).toHaveTextContent('14:02');
    expect(spalte).toHaveTextContent('#12');
    expect(screen.getByText('Inhalt')).toBeInTheDocument();
  });

  it('lässt die Zeitspalte ohne `zeit` ganz weg', () => {
    const { container } = render(<KommKarte>Inhalt</KommKarte>);
    expect(container.querySelector('[data-lfh="komm-karte-zeit"]')).toBeNull();
  });
});

/**
 * Ein Wert so, wie jsdom ihn für diese Eigenschaft im `style` ablegt (Farben in Kurzschreibweisen
 * bleiben Hex, Einzelfarben werden `rgb(…)`). Ohne ThemeProvider gilt die Tagpalette.
 */
function wieGesetzt(eigenschaft: 'boxShadow' | 'background' | 'borderInlineStart', wert: string) {
  const probe = document.createElement('div');
  probe.style[eigenschaft] = wert;
  return probe.style[eigenschaft];
}

const LINIEN = `inset 0 2px 0 ${farbenHell.bedien}, inset 0 -2px 0 ${farbenHell.bedien}`;

describe('KommKarte — Deeplink-Hervorhebung (LFH-896, Spec `deeplink-hervorhebung`)', () => {
  it('trägt Ober- und Unterlinie in `bedien` auf `bedienFlaeche`, keinen Ring', () => {
    const { container } = render(<KommKarte hervorgehoben>Inhalt</KommKarte>);
    const k = karte(container);
    expect(k).toHaveAttribute('data-hervorgehoben', 'true');
    expect(k.style.boxShadow).toBe(wieGesetzt('boxShadow', LINIEN));
    expect(k.style.boxShadow).not.toMatch(/(^|,\s*)0 0 0 2px/);
    expect(k.style.background).toBe(wieGesetzt('background', farbenHell.bedienFlaeche));
  });

  it('eine alarmierte Karte behält angesprungen Alarmfläche und Alarmkante', () => {
    const { container } = render(
      <KommKarte alarm hervorgehoben>
        Inhalt
      </KommKarte>,
    );
    const k = karte(container);
    expect(k).toHaveAttribute('data-alarm', 'true');
    expect(k.style.background).toBe(wieGesetzt('background', farbenHell.alarmFlaeche));
    expect(k.style.borderInlineStart).toBe(
      wieGesetzt('borderInlineStart', `3px solid ${farbenHell.alarm}`),
    );
    expect(k.style.boxShadow).toBe(wieGesetzt('boxShadow', LINIEN));
  });

  it('ohne Markierung trägt die Karte keinen Schatten und steht auf dem Paneel', () => {
    const { container } = render(<KommKarte>Inhalt</KommKarte>);
    const k = karte(container);
    expect(k.style.boxShadow).toBe('');
    expect(k.style.background).toBe(wieGesetzt('background', farbenHell.paneel));
  });
});
