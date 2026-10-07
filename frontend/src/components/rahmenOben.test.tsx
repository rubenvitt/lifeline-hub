/**
 * Die gemessene Höhe dessen, was oben klebt (LFH-952, D2). jsdom rechnet kein Layout: die Höhe
 * kommt hier aus `offsetHeight`, das der Test setzt; das gerenderte Kleben misst
 * `e2e/rahmen-stehen-bleiben.spec.ts`.
 */
import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useCallback, useRef } from 'react';
import {
  RAHMEN_OBEN_VAR,
  leseRahmenOben,
  useRahmenOben,
  useRahmenObenFuer,
  useRahmenObenQuelle,
} from './rahmenOben';

function Quelle({ hoehe, aktiv, name }: { hoehe: number; aktiv: boolean; name: string }) {
  const ref = useRahmenObenQuelle<HTMLDivElement>(aktiv);
  return (
    <div
      data-testid={name}
      ref={(el) => {
        if (el) Object.defineProperty(el, 'offsetHeight', { configurable: true, value: hoehe });
        ref(el);
      }}
    />
  );
}

/** Dieselbe Quelle (ein Hook), aber React tauscht das Element: so hängt der Rahmen nach einer Sackgasse neu ein. */
function Tausch({ variante }: { variante: 'alt' | 'neu' }) {
  const ref = useRahmenObenQuelle<HTMLElement>(true);
  const mit = (hoehe: number) => (el: HTMLElement | null) => {
    if (el) Object.defineProperty(el, 'offsetHeight', { configurable: true, value: hoehe });
    ref(el);
  };
  return variante === 'alt' ? <div key="alt" ref={mit(52)} /> : <header key="neu" ref={mit(73)} />;
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

  it('ein getauschtes Element unter derselben Quelle wird neu gemessen (Fehlerausstieg)', () => {
    const { rerender } = render(<Tausch variante="alt" />);
    expect(leseRahmenOben()).toBe(52);
    rerender(<Tausch variante="neu" />);
    expect(leseRahmenOben()).toBe(73);
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

  it('in Drawer und Modal ist der Versatz 0, im Dokument die Rahmenhöhe', () => {
    function Abnehmer({ name }: { name: string }) {
      const ref = useRef<HTMLSpanElement>(null);
      const versatz = useRahmenObenFuer(useCallback(() => ref.current, []));
      return (
        <span ref={ref} data-testid={name}>
          {versatz}
        </span>
      );
    }
    render(
      <>
        <Quelle hoehe={52} aktiv name="kopf" />
        <Abnehmer name="dokument" />
        <div className="ant-drawer-body">
          <Abnehmer name="drawer" />
        </div>
        <div className="ant-modal-wrap">
          <Abnehmer name="modal" />
        </div>
      </>,
    );
    expect(screen.getByTestId('dokument').textContent).toBe('52');
    expect(screen.getByTestId('drawer').textContent).toBe('0');
    expect(screen.getByTestId('modal').textContent).toBe('0');
  });
});
