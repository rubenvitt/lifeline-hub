/**
 * Die gemessene Höhe dessen, was oben klebt (LFH-952, D2). jsdom rechnet kein Layout: die Höhe
 * kommt hier aus `offsetHeight`, das der Test setzt; das gerenderte Kleben misst
 * `e2e/rahmen-stehen-bleiben.spec.ts`.
 */
import { act, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { RAHMEN_OBEN_VAR, leseRahmenOben, useRahmenOben, useRahmenObenQuelle } from './rahmenOben';

function Quelle({ hoehe, aktiv, name }: { hoehe: number; aktiv: boolean; name: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useRahmenObenQuelle(ref, aktiv);
  return (
    <div
      data-testid={name}
      ref={(el) => {
        if (el) Object.defineProperty(el, 'offsetHeight', { configurable: true, value: hoehe });
        ref.current = el;
      }}
    />
  );
}

function Anzeige() {
  return <span data-testid="anzeige">{useRahmenOben()}</span>;
}

function variable() {
  return document.documentElement.style.getPropertyValue(RAHMEN_OBEN_VAR);
}

afterEach(() => {
  document.documentElement.style.removeProperty(RAHMEN_OBEN_VAR);
});

describe('rahmenOben', () => {
  it('ohne klebendes Element ist die Höhe 0', () => {
    render(<Anzeige />);
    expect(leseRahmenOben()).toBe(0);
    expect(screen.getByTestId('anzeige').textContent).toBe('0');
  });

  it('eine aktive Quelle schreibt ihre Höhe als Zahl und als CSS-Variable', () => {
    render(
      <>
        <Quelle hoehe={52} aktiv name="kopf" />
        <Anzeige />
      </>,
    );
    expect(leseRahmenOben()).toBe(52);
    expect(variable()).toBe('52px');
    expect(screen.getByTestId('anzeige').textContent).toBe('52');
  });

  it('eine inaktive Quelle zählt nicht (Gegenprobe zur aktiven)', () => {
    render(<Quelle hoehe={52} aktiv={false} name="kopf" />);
    expect(leseRahmenOben()).toBe(0);
  });

  it('zwei aktive Quellen addieren sich, das Aushängen nimmt den Anteil wieder weg', () => {
    const { rerender } = render(
      <>
        <Quelle hoehe={52} aktiv name="kopf" />
        <Quelle hoehe={40} aktiv name="zeile" />
      </>,
    );
    expect(leseRahmenOben()).toBe(92);
    rerender(<Quelle hoehe={52} aktiv name="kopf" />);
    expect(leseRahmenOben()).toBe(52);
    rerender(<></>);
    expect(leseRahmenOben()).toBe(0);
    expect(variable()).toBe('0px');
  });

  it('wird eine Quelle inaktiv, fällt ihr Anteil weg, und die Anzeige folgt', () => {
    const { rerender } = render(
      <>
        <Quelle hoehe={52} aktiv name="kopf" />
        <Anzeige />
      </>,
    );
    act(() => {
      rerender(
        <>
          <Quelle hoehe={52} aktiv={false} name="kopf" />
          <Anzeige />
        </>,
      );
    });
    expect(screen.getByTestId('anzeige').textContent).toBe('0');
  });
});
